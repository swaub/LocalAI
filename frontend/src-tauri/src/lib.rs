mod commands;

use commands::{start_backend, stop_backend, check_backend_health, get_backend_status, BackendState};
use tauri::{Manager, Emitter};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .manage(BackendState::default())
        .invoke_handler(tauri::generate_handler![
            start_backend,
            stop_backend,
            check_backend_health,
            get_backend_status
        ])
        .setup(|app| {
            // Setup logging in debug mode
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Auto-start the backend
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                log::info!("Starting backend process...");

                // Get the backend state
                let state = app_handle.state::<BackendState>();

                match start_backend(app_handle.clone(), state).await {
                    Ok(msg) => {
                        log::info!("Backend: {}", msg);
                        let _ = app_handle.emit("backend-started", ());
                    }
                    Err(e) => {
                        log::error!("Failed to start backend: {}", e);
                        let _ = app_handle.emit("backend-error", e);
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Stop backend when window closes
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app_handle = window.app_handle().clone();
                let state: tauri::State<BackendState> = app_handle.state();

                // Stop the backend synchronously
                let mut guard = match state.process.lock() {
                    Ok(g) => g,
                    Err(_) => return,
                };
                if let Some(child) = guard.take() {
                    let _ = child.kill();
                    log::info!("Backend process stopped on window close");
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
