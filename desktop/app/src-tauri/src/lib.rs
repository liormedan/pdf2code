//! The Rust side of the window.
//!
//! It owns two things the WebView is never given: the engine process, and — from
//! sprint 5 — the filesystem. The front end names what it wants and this side decides
//! whether that is allowed, which is the boundary desktop/architecture.md §1 describes.

mod sidecar;

use tauri::Manager;

/// Report what the app is, for an About box and for bug reports.
///
/// The version is read from Cargo at compile time rather than duplicated in TypeScript,
/// so a released binary cannot disagree with itself about which release it is.
#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Started here rather than lazily on first use: the status bar should be
            // truthful from the first frame, and an engine that cannot start is
            // something to find out about at launch rather than mid-conversion.
            let engine = sidecar::Engine::new();
            engine.start(app.handle());
            app.manage(engine);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            sidecar::engine_status,
            sidecar::engine_job_id,
            sidecar::engine_call,
            sidecar::engine_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
