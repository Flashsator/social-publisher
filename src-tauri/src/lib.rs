mod cloudinary;
mod error;
mod oauth;
mod platforms;
mod vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            vault::vault_set,
            vault::vault_get,
            vault::vault_delete,
            vault::vault_wipe_all,
            vault::vault_status,
            oauth::oauth_flow,
            oauth::facebook_list_pages,
            oauth::instagram_resolve_user,
            oauth::threads_resolve_user,
            cloudinary::cloudinary_upload,
            platforms::facebook::publish_facebook,
            platforms::instagram::publish_instagram,
            platforms::threads::publish_threads,
            platforms::youtube::publish_youtube,
            platforms::tiktok::publish_tiktok,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
