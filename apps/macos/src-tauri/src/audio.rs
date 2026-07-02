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
    handle: JoinHandle<Result<(), String>>,
    path: PathBuf,
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
    let thread_path = path.clone();
    let handle = std::thread::spawn(move || record(thread_path, stop_rx));

    *guard = Some(Running {
        stop_tx,
        handle,
        path,
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

    // Signal the capture thread to stop, then wait for it to finalize the WAV.
    let _ = running.stop_tx.send(());
    running
        .handle
        .join()
        .map_err(|_| "capture thread panicked".to_string())??;

    running
        .path
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "capture path is not valid UTF-8".to_string())
}

/// Records from the default input device until a stop signal arrives, writing a
/// 16-bit PCM WAV to `path`. Runs on its own thread (owns the `!Send` stream).
fn record(path: PathBuf, stop_rx: Receiver<()>) -> Result<(), String> {
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

    drop(stream); // stop capturing before finalizing
    if let Some(writer) = writer
        .lock()
        .map_err(|_| "writer poisoned".to_string())?
        .take()
    {
        writer.finalize().map_err(|e| e.to_string())?;
    }
    Ok(())
}
