//! The Rust side of the window.
//!
//! It owns two things the WebView is never given: the engine process, and — from
//! sprint 5 — the filesystem. The front end names what it wants and this side decides
//! whether that is allowed, which is the boundary desktop/architecture.md §1 describes.

mod documents;
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
        // Registered so `documents::pick_document` can open a native dialog. The window
        // is given none of this plugin's permissions — it calls our command, and the
        // decision about which file may be read stays on this side.
        .plugin(tauri_plugin_dialog::init())
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
            documents::pick_document,
            documents::output_dir,
            documents::read_output,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
