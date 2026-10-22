use std::sync::Mutex;
use tauri::{Emitter, Manager, RunEvent};

mod sidecar;
use sidecar::Sidecar;

struct AppState {
    sidecar: Mutex<Sidecar>,
    /// Set when the engine could not be started, so the UI can show why.
    start_error: Mutex<Option<String>>,
}

/// Send one JSON-RPC request to the engine. The front end picks the id and
/// matches the response when it arrives on the `core` event.
#[tauri::command]
fn rpc(
    state: tauri::State<'_, AppState>,
    id: u64,
    method: String,
    params: Option<serde_json::Value>,
) -> Result<(), String> {
    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params.unwrap_or(serde_json::Value::Null),
    });
    state.sidecar.lock().map_err(|e| e.to_string())?.send(&request)
}

/// Returns null when the engine is running, or the reason it is not.
#[tauri::command]
fn engine_error(state: tauri::State<'_, AppState>) -> Option<String> {
    state.start_error.lock().ok().and_then(|e| e.clone())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    let app = tauri::Builder::default()
        .manage(AppState {
            sidecar: Mutex::new(Sidecar::new()),
            start_error: Mutex::new(None),
        })
        .setup(|app| {
            if std::env::var_os("AIDE_SMOKE_TEST").is_some() {
                std::thread::spawn(|| {
                    std::thread::sleep(std::time::Duration::from_secs(30));
                    eprintln!("smoke test: engine did not report ready within 30 s");
                    std::process::exit(2);
                });
            }
            let handle = app.handle().clone();
            let state = app.state::<AppState>();
            let result = state.sidecar.lock().unwrap().start(&handle);
            if let Err(message) = result {
                log::error!("{message}");
                if std::env::var_os("AIDE_SMOKE_TEST").is_some() {
                    eprintln!("smoke test: {message}");
                    std::process::exit(3);
                }
                *state.start_error.lock().unwrap() = Some(message.clone());
                let _ = handle.emit(
                    "core",
                    serde_json::json!({ "event": "sidecar.error", "data": { "message": message } }),
                );
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![rpc, engine_error])
        .build(tauri::generate_context!())
        .expect("error while building the AIDE_DEV window");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Ok(mut sidecar) = handle.state::<AppState>().sidecar.lock() {
                sidecar.stop();
            }
        }
    });
}
