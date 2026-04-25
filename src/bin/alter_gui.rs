// @group Configuration : Suppress the console window in release builds (Windows)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// @group Configuration : Tauri desktop app entry point — wraps the alter daemon in a native window

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // @group BusinessLogic > Daemon : Start the alter daemon in-process.
            // If port 2999 is already bound (CLI daemon running), the bind fails and
            // we simply connect the window to the already-running daemon — that is fine.
            let config = alter::config::daemon_config::DaemonConfig::default();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = alter::daemon::run(config).await {
                    // "address already in use" is expected when a CLI daemon is running
                    tracing::warn!("daemon task ended: {e:#}");
                }
            });

            // @group BusinessLogic > Window : The window is visible immediately (configured in
            // tauri.conf.json). It starts at the server URL; WebView shows a brief
            // "connection refused" page while the daemon binds the port (~1 s), then we
            // navigate to the real URL so the dashboard loads cleanly.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                wait_for_server(2999).await;
                if let Some(w) = handle.get_webview_window("main") {
                    // Navigate (or reload) to the dashboard once the server is ready
                    let _ = w.eval("window.location.href = 'http://127.0.0.1:2999/'");
                    let _ = w.set_focus();
                }
            });

            // @group BusinessLogic > Tray : Build the system tray icon and context menu
            let show_i    = MenuItem::with_id(app, "show",    "Show Dashboard",  true, None::<&str>)?;
            let browser_i = MenuItem::with_id(app, "browser", "Open in Browser", true, None::<&str>)?;
            let sep       = PredefinedMenuItem::separator(app)?;
            let quit_i    = MenuItem::with_id(app, "quit",    "Quit alter",      true, None::<&str>)?;
            let menu      = Menu::with_items(app, &[&show_i, &browser_i, &sep, &quit_i])?;

            // Use the configured app icon when available, else a solid indigo square
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("alter — process manager")
                .on_menu_event(on_menu_event)
                .on_tray_icon_event(on_tray_event);

            tray = if let Some(icon) = app.default_window_icon() {
                tray.icon(icon.clone())
            } else {
                tray.icon(tauri::image::Image::new_owned(
                    solid_icon_rgba(16, 0x63, 0x66, 0xf1),
                    16,
                    16,
                ))
            };

            tray.build(app)?;
            Ok(())
        })
        // @group BusinessLogic > Window : Hide to tray instead of closing the app
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to start alter GUI");
}

// @group BusinessLogic > Tray : Context-menu handler
fn on_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    match event.id.as_ref() {
        "show" => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
        "browser" => {
            #[cfg(target_os = "windows")]
            let _ = std::process::Command::new("cmd")
                .args(["/c", "start", "http://127.0.0.1:2999/"])
                .spawn();
            #[cfg(target_os = "macos")]
            let _ = std::process::Command::new("open")
                .arg("http://127.0.0.1:2999/")
                .spawn();
            #[cfg(target_os = "linux")]
            let _ = std::process::Command::new("xdg-open")
                .arg("http://127.0.0.1:2999/")
                .spawn();
        }
        "quit" => {
            // Ask daemon to save state, then exit
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = reqwest::Client::new()
                    .post("http://127.0.0.1:2999/api/v1/system/shutdown")
                    .timeout(std::time::Duration::from_secs(5))
                    .send()
                    .await;
                tokio::time::sleep(std::time::Duration::from_millis(400)).await;
                handle.exit(0);
            });
        }
        _ => {}
    }
}

// @group BusinessLogic > Tray : Left-click toggles window visibility
fn on_tray_event(tray: &tauri::tray::TrayIcon, event: TrayIconEvent) {
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        let app = tray.app_handle();
        if let Some(w) = app.get_webview_window("main") {
            if w.is_visible().unwrap_or(false) {
                let _ = w.hide();
            } else {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
    }
}

// @group Utilities : Poll TCP until the server accepts connections (max 10 s)
async fn wait_for_server(port: u16) {
    let addr = format!("127.0.0.1:{port}");
    for _ in 0..100 {
        if tokio::net::TcpStream::connect(&addr).await.is_ok() {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    tracing::warn!("alter HTTP server did not become ready within 10 s");
}

// @group Utilities : Solid-colour RGBA pixel buffer — tray icon fallback
fn solid_icon_rgba(size: u32, r: u8, g: u8, b: u8) -> Vec<u8> {
    (0..size * size).flat_map(|_| [r, g, b, 0xff]).collect()
}
