//! Native Deepgram REST transcription (M3).
//!
//! `@deepgram/sdk`'s `AbstractRestClient` constructor refuses to run in any
//! browser-like environment unless a `proxy` option is configured — it
//! throws unconditionally, before a custom `fetch` implementation even gets a
//! chance to run. Tauri's WebView is a real browser engine, so the SDK-based
//! `DeepgramProvider` in `@verba/core` cannot be used here. This module makes
//! the same REST call natively instead; `deepgramTauriProvider.ts` is the
//! concrete `TranscriptionBackend` (from `@verba/core`) that calls it.

use serde::Serialize;

/// Sentinel error string the frontend checks for to distinguish "bad API
/// key, clear it and re-prompt" from any other transcription failure.
///
/// Keep in sync with `UNAUTHORIZED_SENTINEL` in
/// `../../src/deepgramTauriProvider.ts` — there is no shared type across the
/// Rust/TypeScript IPC boundary to enforce this, so a drift here silently
/// breaks the invalid-key recovery path (the key is never cleared, and the
/// user sees a raw `Transcription failed: deepgram_unauthorized` instead).
const DEEPGRAM_UNAUTHORIZED: &str = "deepgram_unauthorized";

#[derive(Serialize)]
pub struct TranscriptionResult {
    text: String,
    #[serde(rename = "detectedLanguage", skip_serializing_if = "Option::is_none")]
    detected_language: Option<String>,
}

/// Transcribes the WAV file at `audio_path` via Deepgram's Nova-3 pre-recorded
/// REST API. `keyterms` are glossary terms already formatted and truncated by
/// the caller (e.g. `"term:2"`); passed through as repeated `keyterm` query
/// params.
#[tauri::command]
pub async fn deepgram_transcribe(
    api_key: String,
    audio_path: String,
    keyterms: Vec<String>,
) -> Result<TranscriptionResult, String> {
    let audio = std::fs::read(&audio_path)
        .map_err(|e| format!("Transcription failed: could not read recording: {e}"))?;

    let mut params: Vec<(&str, String)> = vec![
        ("model", "nova-3".to_string()),
        ("language", "multi".to_string()),
        ("smart_format", "true".to_string()),
        ("detect_language", "true".to_string()),
    ];
    for kt in &keyterms {
        params.push(("keyterm", kt.clone()));
    }

    let client = reqwest::Client::new();
    let response = client
        .post("https://api.deepgram.com/v1/listen")
        .query(&params)
        .header("Authorization", format!("Token {api_key}"))
        .header("Content-Type", "audio/wav")
        .body(audio)
        .send()
        .await
        .map_err(|e| format!("Transcription failed: {e}"))?;

    let status = response.status();
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err(DEEPGRAM_UNAUTHORIZED.to_string());
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Transcription failed: could not parse response: {e}"))?;

    if !status.is_success() {
        let detail = body
            .get("err_msg")
            .or_else(|| body.get("reason"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        return Err(format!("Transcription failed: {detail}"));
    }

    let channel = body
        .get("results")
        .and_then(|r| r.get("channels"))
        .and_then(|c| c.get(0));

    let text = channel
        .and_then(|c| c.get("alternatives"))
        .and_then(|a| a.get(0))
        .and_then(|a| a.get("transcript"))
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();

    let detected_language = channel
        .and_then(|c| c.get("detected_language"))
        .and_then(|l| l.as_str())
        .map(|s| s.to_string());

    Ok(TranscriptionResult {
        text,
        detected_language,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unauthorized_sentinel_matches_the_frontend_constant() {
        // Guards the cross-language IPC contract with UNAUTHORIZED_SENTINEL
        // in deepgramTauriProvider.ts — this test only catches drift on the
        // Rust side, so keep both in sync by hand when changing either.
        assert_eq!(DEEPGRAM_UNAUTHORIZED, "deepgram_unauthorized");
    }
}
