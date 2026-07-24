//! Microphone capture → 16-bit mono/stereo WAV (M2).
//!
//! cpal `Stream`s are `!Send`, so the stream is created, played, and dropped
//! entirely on a dedicated capture thread; `start_capture`/`stop_capture`
//! coordinate with it over an mpsc channel and Tauri managed state.
//!
//! NOTE (verification): this file targets macOS (CoreAudio) and was authored in
//! a headless Linux environment without the audio toolchain, so it has **not**
//! been compiled or run. It follows the standard cpal + hound patterns but is
//! the piece most likely to need iteration on a Mac (sample-format handling,
//! crate-version API drift).

use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use tauri::{AppHandle, Manager};

/// Managed state holding the in-flight capture, if any.
#[derive(Default)]
pub struct CaptureState(pub Mutex<Option<Running>>);

pub struct Running {
    stop_tx: Sender<()>,
    /// The capture thread finalizes the WAV and reports its path here *before*
    /// tearing down the (possibly blocking) cpal stream, so `stop_capture` can
    /// return as soon as the audio is on disk.
    done_rx: Receiver<Result<PathBuf, String>>,
    /// Kept only to own the thread; intentionally never joined — the thread
    /// drops the cpal stream on its own time after reporting back.
    _handle: JoinHandle<()>,
}

#[tauri::command]
pub fn start_capture(app: AppHandle, state: tauri::State<CaptureState>) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "capture state poisoned".to_string())?;
    if guard.is_some() {
        return Err("Recording already in progress.".into());
    }

    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("verba-capture.wav");

    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (done_tx, done_rx) = mpsc::channel::<Result<PathBuf, String>>();
    let thread_path = path;
    let handle = std::thread::spawn(move || {
        // On a setup failure `record` returns Err without having reported; forward
        // it so `stop_capture` (blocked on `done_rx`) never waits forever. On the
        // success path `record` sends the finalized-WAV result itself, before the
        // (possibly blocking) stream teardown, so there is nothing to forward here.
        if let Err(e) = record(thread_path, stop_rx, &done_tx) {
            let _ = done_tx.send(Err(e));
        }
    });

    *guard = Some(Running {
        stop_tx,
        done_rx,
        _handle: handle,
    });
    Ok(())
}

#[tauri::command]
pub fn stop_capture(state: tauri::State<CaptureState>) -> Result<String, String> {
    let running = {
        let mut guard = state
            .0
            .lock()
            .map_err(|_| "capture state poisoned".to_string())?;
        guard
            .take()
            .ok_or_else(|| "No recording in progress.".to_string())?
    };

    // Signal the capture thread to stop and wait for it to finalize the WAV —
    // NOT for it to tear down the cpal/CoreAudio stream. The thread reports the
    // finalized path over `done_rx` before dropping the stream, so we return as
    // soon as the audio is on disk and never block on the stream teardown, which
    // on macOS can take seconds or hang. The thread is intentionally not joined;
    // it drops the stream on its own and exits.
    let _ = running.stop_tx.send(());
    let path = running
        .done_rx
        .recv()
        .map_err(|_| "capture thread ended before finalizing the recording".to_string())??;

    path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "capture path is not valid UTF-8".to_string())
}

/// Records from the default input device until a stop signal arrives, writing a
/// 16-bit PCM WAV to `path`. Runs on its own thread (owns the `!Send` stream).
///
/// On success it reports the finalized WAV path over `done_tx` *before* dropping
/// the cpal stream, so `stop_capture` never blocks on the CoreAudio teardown. A
/// setup error is returned instead (and forwarded by the spawning closure).
fn record(
    path: PathBuf,
    stop_rx: Receiver<()>,
    done_tx: &Sender<Result<PathBuf, String>>,
) -> Result<(), String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "No input (microphone) device found.".to_string())?;
    let supported = device.default_input_config().map_err(|e| e.to_string())?;

    let spec = hound::WavSpec {
        channels: supported.channels(),
        sample_rate: supported.sample_rate().0,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let writer = hound::WavWriter::create(&path, spec).map_err(|e| e.to_string())?;
    let writer = Arc::new(Mutex::new(Some(writer)));

    let sample_format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let err_fn = |err| eprintln!("[Verba] audio stream error: {err}");

    // Write helper: push i16 samples into the shared WAV writer.
    let w = writer.clone();
    let write_i16 = move |samples: &[i16]| {
        if let Ok(mut guard) = w.lock() {
            if let Some(writer) = guard.as_mut() {
                for &s in samples {
                    let _ = writer.write_sample(s);
                }
            }
        }
    };

    let stream = match sample_format {
        SampleFormat::I16 => {
            let write = write_i16.clone();
            device.build_input_stream(
                &config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| write(data),
                err_fn,
                None,
            )
        }
        SampleFormat::U16 => {
            let write = write_i16.clone();
            device.build_input_stream(
                &config,
                move |data: &[u16], _: &cpal::InputCallbackInfo| {
                    let converted: Vec<i16> =
                        data.iter().map(|&s| (s as i32 - 32768) as i16).collect();
                    write(&converted);
                },
                err_fn,
                None,
            )
        }
        SampleFormat::F32 => {
            let write = write_i16.clone();
            device.build_input_stream(
                &config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    let converted: Vec<i16> = data
                        .iter()
                        .map(|&s| (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
                        .collect();
                    write(&converted);
                },
                err_fn,
                None,
            )
        }
        other => return Err(format!("Unsupported sample format: {other:?}")),
    }
    .map_err(|e| e.to_string())?;

    stream.play().map_err(|e| e.to_string())?;

    // Block until stop is requested (or the sender is dropped).
    let _ = stop_rx.recv();

    // Finalize the WAV FIRST — before tearing down the stream. Taking the writer
    // out of the `Option` makes the audio callback a no-op (it only writes while
    // `Some`), so this can't race a late callback, and it means finalization no
    // longer depends on the stream being dropped first.
    let finalize_result = (|| -> Result<PathBuf, String> {
        if let Some(writer) = writer
            .lock()
            .map_err(|_| "writer poisoned".to_string())?
            .take()
        {
            writer.finalize().map_err(|e| e.to_string())?;
        }
        Ok(path)
    })();

    // Hand the finalized-WAV result back to `stop_capture` NOW, before the stream
    // teardown. That is the whole point: the user-visible flow returns the moment
    // the audio is on disk and never waits on the drop below.
    let _ = done_tx.send(finalize_result);

    // Stop and drop the stream LAST. On macOS this cpal/CoreAudio teardown can
    // block for seconds (or, rarely, hang); doing it here — after we've reported
    // the WAV path — keeps that latency entirely off the dictation flow.
    let _ = stream.pause();
    drop(stream);
    Ok(())
}
