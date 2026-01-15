use std::sync::Mutex;
use tauri::Emitter;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

pub struct BackendState {
    pub process: Mutex<Option<CommandChild>>,
}

impl Default for BackendState {
    fn default() -> Self {
        Self {
            process: Mutex::new(None),
        }
    }
}

#[tauri::command]
pub async fn start_backend(
    app: tauri::AppHandle,
    state: tauri::State<'_, BackendState>,
) -> Result<String, String> {
    // Check if already running
    {
        let guard = state.process.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Ok("Backend already running".to_string());
        }
    }

    // Spawn the sidecar
    let sidecar = app
        .shell()
        .sidecar("localai-backend")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?;

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("Failed to spawn backend: {}", e))?;

    // Store the child process
    {
        let mut guard = state.process.lock().map_err(|e| e.to_string())?;
        *guard = Some(child);
    }

    // Spawn a task to monitor backend output
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    log::info!("[Backend] {}", text);
                    let _ = app_handle.emit("backend-log", text.to_string());
                }
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line);
                    log::info!("[Backend] {}", text);
                    let _ = app_handle.emit("backend-log", text.to_string());
                }
                CommandEvent::Error(err) => {
                    log::error!("[Backend Error] {}", err);
                    let _ = app_handle.emit("backend-error", err.clone());
                }
                CommandEvent::Terminated(payload) => {
                    log::info!("[Backend] Process terminated with code: {:?}", payload.code);
                    let _ = app_handle.emit("backend-terminated", payload.code);
                }
                _ => {}
            }
        }
    });

    // Give the backend a moment to start
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    Ok("Backend started".to_string())
}

#[tauri::command]
pub async fn stop_backend(
    state: tauri::State<'_, BackendState>,
) -> Result<String, String> {
    let mut guard = state.process.lock().map_err(|e| e.to_string())?;

    if let Some(child) = guard.take() {
        child.kill().map_err(|e| format!("Failed to kill backend: {}", e))?;
        Ok("Backend stopped".to_string())
    } else {
        Ok("Backend was not running".to_string())
    }
}

#[tauri::command]
pub async fn check_backend_health() -> Result<bool, String> {
    let client = reqwest::Client::new();

    match client
        .get("http://localhost:8000/api/health")
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
    {
        Ok(response) => Ok(response.status().is_success()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub fn get_backend_status(
    state: tauri::State<'_, BackendState>,
) -> Result<bool, String> {
    let guard = state.process.lock().map_err(|e| e.to_string())?;
    Ok(guard.is_some())
}
