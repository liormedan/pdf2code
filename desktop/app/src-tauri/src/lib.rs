//! The Rust side of the window.
//!
//! It owns two things the WebView is never given: the engine process, and — from
//! sprint 5 — the filesystem. The front end names what it wants and this side decides
//! whether that is allowed, which is the boundary desktop/architecture.md §1 describes.

mod deliver;
mod documents;
mod projects;
mod settings;
mod storage;
mod sidecar;
mod workbench;

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

            // The project store. Opened once at startup so a failure is visible now
            // rather than on the first conversion somebody wanted to keep.
            app.manage(projects::Store(std::sync::Mutex::new(projects::open(app.handle())?)));

            // Where the engine is allowed to write, which starts empty: nothing is
            // writable until a native dialog or this side produces the path.
            app.manage(workbench::Writable::default());
            // Last run's page thumbnails. They are a rendering of somebody's document,
            // so they are cleared at launch rather than left to accumulate.
            workbench::clear_scratch(app.handle());

            // The window opens where it was left. Restored here rather than declared in
            // tauri.conf.json, because a remembered size is a fact about this machine and
            // the config is a fact about the product.
            if let (Some(window), Some(box_)) = (
                app.get_webview_window("main"),
                settings::load(app.handle()).window,
            ) {
                let _ = window.set_size(tauri::PhysicalSize::new(box_.width, box_.height));
                let _ = window.set_position(tauri::PhysicalPosition::new(box_.x, box_.y));
            }
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
            documents::describe_document,
            documents::pick_documents,
            documents::pick_output_root,
            documents::clear_output_root,
            documents::output_root,
            projects::record_project,
            projects::list_projects,
            projects::forget_project,
            projects::source_state,
            settings::get_settings,
            settings::save_defaults,
            settings::mark_intro_seen,
            settings::credits,
            storage::storage_summary,
            storage::clean_old_output,
            workbench::pick_save_path,
            workbench::pick_export_dir,
            workbench::workbench_dir,
            workbench::read_image,
            deliver::list_output,
            deliver::open_path,
            deliver::reveal_path,
        ])
        // Saved when the window closes rather than on every drag: one write instead of
        // hundreds, and the only moment the answer is final.
        //
        // **Inner size, outer position.** `set_size` restores the inner size and
        // `set_position` the outer one, so those are the two to store. The first version
        // saved `outer_size`, and the file said 1216x839 for a window configured at
        // 1200x800 — the title bar and the borders. Restoring that as an inner size grows
        // the window by the frame on every close and open, a few pixels at a time. That is
        // the kind of thing somebody eventually reports as "it keeps getting bigger" and
        // nobody reproduces in one sitting.
        .on_window_event(|window, event| {
            if !matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                return;
            }
            let Ok(size) = window.inner_size() else { return };
            let Ok(position) = window.outer_position() else { return };
            let _ = settings::update(window.app_handle(), |s| {
                s.window = Some(settings::WindowBox {
                    x: position.x,
                    y: position.y,
                    width: size.width,
                    height: size.height,
                });
            });
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
