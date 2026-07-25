//! Shared JS→Rust cancellation for the native HTTP commands (TF-521).
//!
//! `anthropic_fetch` and `deepgram_transcribe` each perform a `reqwest` call
//! that, once dispatched, a Tauri `invoke` cannot cancel from the JS side. So a
//! frontend timeout (`withCleanupTimeout` / `withTranscribeTimeout`) that fired
//! mid-request used to leave the native call running to its own 30s `reqwest`
//! timeout — still costing an Anthropic/Deepgram request for a result the
//! frontend had already discarded (a small, rare, but real cost leak).
//!
//! This module bridges that gap. The JS caller mints a request id and passes it
//! to the command; the command registers a [`CancellationToken`] under that id
//! in a shared [`CancelRegistry`] (managed as Tauri state) and runs its request
//! under [`run_cancellable`], which `select!`s the request future against the
//! token. The JS `abort` listener fires the [`cancel_request`] command, which
//! cancels the token and stops the in-flight request.

use std::collections::HashMap;
use std::future::Future;
use std::sync::Mutex;

use tokio::select;
use tokio_util::sync::CancellationToken;

/// Registry of in-flight cancellable requests, keyed by the JS-supplied id.
/// Managed as Tauri state so [`cancel_request`] can look tokens up. Entries are
/// removed as soon as the request settles (see [`run_cancellable`]'s guard), so
/// the map only ever holds genuinely in-flight requests.
#[derive(Default)]
pub struct CancelRegistry {
    tokens: Mutex<HashMap<String, CancellationToken>>,
}

impl CancelRegistry {
    /// Registers a fresh token for `id` and returns a clone the caller awaits.
    /// A duplicate id replaces the previous token; the JS ids are UUIDs, so this
    /// only ever matters defensively.
    fn register(&self, id: &str) -> CancellationToken {
        let token = CancellationToken::new();
        self.tokens
            .lock()
            .expect("cancel registry mutex poisoned")
            .insert(id.to_string(), token.clone());
        token
    }

    /// Removes `id` from the registry. Called when a request settles so a
    /// completed request never leaves a stale token behind.
    fn unregister(&self, id: &str) {
        self.tokens
            .lock()
            .expect("cancel registry mutex poisoned")
            .remove(id);
    }

    /// Cancels the token registered under `id`, if any. An unknown id is a
    /// no-op — the request may have already settled and unregistered, so the JS
    /// side can fire-and-forget the cancel without racing the response.
    pub fn cancel(&self, id: &str) {
        if let Some(token) = self
            .tokens
            .lock()
            .expect("cancel registry mutex poisoned")
            .get(id)
        {
            token.cancel();
        }
    }

    /// Number of currently-registered tokens. Test-only, for leak assertions.
    #[cfg(test)]
    fn len(&self) -> usize {
        self.tokens
            .lock()
            .expect("cancel registry mutex poisoned")
            .len()
    }
}

/// Returned by [`run_cancellable`] when the request was cancelled mid-flight.
#[derive(Debug, PartialEq, Eq)]
pub struct Cancelled;

/// Runs `fut` under cancellation control tied to `id`.
///
/// When `id` is `Some`, a token is registered under it and `fut` races the
/// token: if [`cancel_request`] cancels the token first, this returns
/// `Err(Cancelled)` and `fut` is dropped (cancelling the in-flight request).
/// When `id` is `None` the caller opted out of cancellation and `fut` runs to
/// completion. The registry entry is always removed on return — via a drop
/// guard — so a token never leaks even if `fut` panics or returns early.
pub async fn run_cancellable<F, T>(
    registry: &CancelRegistry,
    id: Option<&str>,
    fut: F,
) -> Result<T, Cancelled>
where
    F: Future<Output = T>,
{
    // No id → the caller opted out; run the request unmediated.
    let Some(id) = id else {
        return Ok(fut.await);
    };

    let token = registry.register(id);
    // RAII cleanup: remove the registry entry however we leave this fn (normal
    // return, cancellation, or a panic in `fut`) so a token never leaks.
    let _guard = UnregisterGuard { registry, id };

    select! {
        _ = token.cancelled() => Err(Cancelled),
        out = fut => Ok(out),
    }
}

/// Removes a registry entry on drop — see [`run_cancellable`].
struct UnregisterGuard<'a> {
    registry: &'a CancelRegistry,
    id: &'a str,
}

impl Drop for UnregisterGuard<'_> {
    fn drop(&mut self) {
        self.registry.unregister(self.id);
    }
}

/// Cancels the in-flight native request registered under `request_id`. Called
/// from the JS `abort` listener in the fetch/transcribe adapters. A no-op if the
/// request already settled (its registry entry is gone). Never errors, so the JS
/// side can fire-and-forget it.
#[tauri::command]
pub fn cancel_request(request_id: String, registry: tauri::State<'_, CancelRegistry>) {
    registry.cancel(&request_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn cancel_marks_the_registered_token_cancelled() {
        let reg = CancelRegistry::default();
        let token = reg.register("id-1");
        assert!(!token.is_cancelled());

        reg.cancel("id-1");

        assert!(token.is_cancelled());
    }

    #[test]
    fn cancel_unknown_id_is_a_noop() {
        let reg = CancelRegistry::default();
        // Must not panic, and must not create an entry.
        reg.cancel("never-registered");
        assert_eq!(reg.len(), 0);
    }

    #[test]
    fn unregister_removes_the_entry() {
        let reg = CancelRegistry::default();
        reg.register("id-1");
        assert_eq!(reg.len(), 1);

        reg.unregister("id-1");

        assert_eq!(reg.len(), 0);
    }

    #[tokio::test]
    async fn run_cancellable_returns_output_and_cleans_up() {
        let reg = CancelRegistry::default();

        let out = run_cancellable(&reg, Some("id-1"), async { 42u8 }).await;

        assert_eq!(out, Ok(42));
        assert_eq!(reg.len(), 0, "the registry entry must be removed on completion");
    }

    #[tokio::test]
    async fn run_cancellable_without_id_runs_directly() {
        let reg = CancelRegistry::default();

        let out = run_cancellable(&reg, None, async { 7u8 }).await;

        assert_eq!(out, Ok(7));
        assert_eq!(reg.len(), 0, "no id means no registration");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn run_cancellable_yields_cancelled_when_cancelled_mid_flight() {
        let reg = Arc::new(CancelRegistry::default());
        let reg2 = reg.clone();

        // A request that never completes on its own — only cancellation ends it.
        let handle = tokio::spawn(async move {
            run_cancellable(&reg2, Some("id-1"), std::future::pending::<u8>()).await
        });

        // Wait until the task has registered its token, then cancel it.
        loop {
            if reg.len() == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
        reg.cancel("id-1");

        let out = handle.await.expect("task panicked");

        assert_eq!(out, Err(Cancelled));
        assert_eq!(reg.len(), 0, "the token must be cleaned up after cancellation");
    }
}
