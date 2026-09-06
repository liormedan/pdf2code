//! Choosing a document, and deciding where its output goes.
//!
//! Both are here rather than in the window, and that is the boundary
//! desktop/architecture.md §1 describes: the front end names what it wants, this side
//! decides whether it is allowed and where it lands. The WebView is never granted the
//! dialog plugin's permissions — it calls `pick_document`, and the plugin is a Rust
//! dependency it cannot reach.
//!
//! The same reasoning picks the output directory. Writing beside someone's source file
//! without asking is a side effect they did not request, so conversions land under the
//! app's own data directory until sprint 5 lets them choose.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Picked {
    pub path: String,
    pub name: String,
    /// Bytes. The window shows it, and sprint 5 compares it on a re-run to notice that
    /// the file changed underneath a saved project.
    pub size: u64,
}

#[tauri::command]
pub fn pick_document(app: AppHandle) -> Option<Picked> {
    // Blocking on purpose: a modal file dialog is modal, and the window has nothing
    // useful to do while it is open. `None` means the person cancelled, which is an
    // answer rather than an error.
    let path = app
        .dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .blocking_pick_file()?;

    let path: PathBuf = path.into_path().ok()?;
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);

    Some(Picked {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        size,
    })
}

/// Where a conversion's output goes.
///
/// Under the app's data directory, one folder per run, named after the document and
/// stamped so a second conversion of the same file does not silently overwrite the
/// first. Sprint 5 replaces this with a folder the person chooses.
#[tauri::command]
pub fn output_dir(app: AppHandle, source: String) -> Result<String, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data directory: {e}"))?
        .join("conversions");

    let stem = PathBuf::from(&source)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "document".into());

    // Seconds since the epoch is enough: two conversions of the same document inside
    // one second is not a case worth a UUID.
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let dir = base.join(format!("{stem}-{stamp}"));
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;

    Ok(dir.to_string_lossy().into_owned())
}
