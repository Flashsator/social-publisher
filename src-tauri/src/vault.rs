use crate::error::{AppError, AppResult};
use keyring::Entry;

const SERVICE: &str = "social-publisher";

pub const KNOWN_KEYS: &[&str] = &[
    "fb_app_id",
    "fb_app_secret",
    "fb_page_id",
    "fb_page_token",
    "ig_app_id",
    "ig_app_secret",
    "ig_user_id",
    "ig_token",
    "ig_token_expires_at",
    "th_app_id",
    "th_app_secret",
    "th_user_id",
    "th_token",
    "th_token_expires_at",
    "cl_cloud_name",
    "cl_api_key",
    "cl_api_secret",
];

fn entry(key: &str) -> AppResult<Entry> {
    Entry::new(SERVICE, key).map_err(AppError::from)
}

#[tauri::command]
pub fn vault_set(key: String, value: String) -> AppResult<()> {
    entry(&key)?.set_password(&value)?;
    Ok(())
}

#[tauri::command]
pub fn vault_get(key: String) -> AppResult<Option<String>> {
    match entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub fn vault_delete(key: String) -> AppResult<()> {
    match entry(&key)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub fn vault_wipe_all() -> AppResult<()> {
    for k in KNOWN_KEYS {
        if let Ok(e) = entry(k) {
            match e.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(_) => {}
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn vault_status() -> AppResult<Vec<(String, bool)>> {
    let mut out = Vec::with_capacity(KNOWN_KEYS.len());
    for k in KNOWN_KEYS {
        let present = matches!(entry(k)?.get_password(), Ok(_));
        out.push(((*k).to_string(), present));
    }
    Ok(out)
}
