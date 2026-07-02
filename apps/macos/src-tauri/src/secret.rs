//! Keychain-backed secret storage (M2). Backs the frontend `TauriSecretStore`.

use keyring::{Entry, Error as KeyringError};

/// Keychain service name; entries are keyed by the core's storage keys
/// (e.g. `verba.deepgramApiKey`, `anthropic-api-key`).
const SERVICE: &str = "ch.talent-factory.verba";

fn entry(key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
