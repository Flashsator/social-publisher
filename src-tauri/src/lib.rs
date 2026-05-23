mod cloudinary;
mod error;
mod oauth;
mod platforms;
mod scheduler;
mod vault;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let sched = scheduler::init_state(app.handle())?;
            app.manage(sched);
            scheduler::spawn_loop(app.handle().clone());

            let show = MenuItem::with_id(app, "show", "顯示視窗 / Show", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "離開 / Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let icon = app
                .default_window_icon()
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("default window icon missing"))?;

            TrayIconBuilder::with_id("main")
                .icon(icon)
                .tooltip("Social Publisher")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            vault::vault_set,
            vault::vault_get,
            vault::vault_delete,
            vault::vault_wipe_all,
            vault::vault_status,
            oauth::oauth_flow,
            oauth::oauth_cancel,
            oauth::facebook_list_pages,
            oauth::facebook_resolve_page,
            oauth::instagram_resolve_user,
            oauth::threads_resolve_user,
            oauth::facebook_debug_token,
            oauth::facebook_inspect_token,
            oauth::instagram_debug_token,
            oauth::threads_debug_token,
            oauth::instagram_refresh_token,
            oauth::threads_refresh_token,
            oauth::youtube_verify,
            cloudinary::cloudinary_upload,
            cloudinary::cloudinary_delete,
            cloudinary::cloudinary_verify,
            platforms::facebook::publish_facebook,
            platforms::instagram::publish_instagram,
            platforms::threads::publish_threads,
            platforms::youtube::publish_youtube,
            platforms::tiktok::publish_tiktok,
            scheduler::schedule_list,
            scheduler::schedule_create,
            scheduler::schedule_update,
            scheduler::schedule_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
