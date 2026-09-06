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

/// Describe a path the window already has — from a drag and drop, or from a saved
/// project being re-run.
///
/// The window can name a path but cannot learn anything about it, which is the same
/// boundary the picker enforces from the other direction.
#[tauri::command]
pub fn describe_document(path: String) -> Option<Picked> {
    let path = PathBuf::from(&path);
    let size = std::fs::metadata(&path).ok()?.len();

    // Only PDFs. A drag and drop can carry anything, and refusing here means the engine
    // is never handed a file it was not built to open.
    if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")) {
        return None;
    }

    Some(Picked {
        name: path.file_name().map(|n| n.to_string_lossy().into_owned())?,
        path: path.to_string_lossy().into_owned(),
        size,
    })
}

/// Choose several documents at once.
#[tauri::command]
pub fn pick_documents(app: AppHandle) -> Vec<Picked> {
    let Some(paths) = app
        .dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .blocking_pick_files()
    else {
        return Vec::new();
    };

    paths
        .into_iter()
        .filter_map(|p| {
            let path: PathBuf = p.into_path().ok()?;
            let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            Some(Picked {
                name: path.file_name().map(|n| n.to_string_lossy().into_owned())?,
                path: path.to_string_lossy().into_owned(),
                size,
            })
        })
        .collect()
}

/// Choose where output should go from now on.
///
/// The chosen folder is remembered **here**, not in the window. If the window held the
/// preference it would have to pass a path into `output_dir`, and a command that
/// creates a directory at any path the front end names is a write primitive — one the
/// person never asked for. This way the only path that can become an output root is one
/// somebody picked in a native dialog.
#[tauri::command]
pub fn pick_output_root(app: AppHandle) -> Option<String> {
    let folder = app.dialog().file().blocking_pick_folder()?;
    let path: PathBuf = folder.into_path().ok()?;
    let chosen = path.to_string_lossy().into_owned();
    let _ = write_output_root(&app, Some(&chosen));
    Some(chosen)
}

/// Go back to keeping output under the app's own data directory.
#[tauri::command]
pub fn clear_output_root(app: AppHandle) -> Result<(), String> {
    write_output_root(&app, None)
}

/// The folder output goes into, if one was chosen.
#[tauri::command]
pub fn output_root(app: AppHandle) -> Option<String> {
    read_output_root(&app)
}

/// The chosen output folder, or none.
///
/// Through `settings.rs` rather than reading the file here. Two modules writing the same
/// document is two modules erasing each other's fields, and this one used to write
/// `{"outputRoot": …}` whole — which was harmless while it was the only setting.
fn read_output_root(app: &AppHandle) -> Option<String> {
    crate::settings::load(app).output_root
}

fn write_output_root(app: &AppHandle, root: Option<&str>) -> Result<(), String> {
    crate::settings::update(app, |settings| {
        settings.output_root = root.map(str::to_owned);
    })
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

/// The largest preview we will hand the window.
///
/// A converted page carries its raster as a data: URI, so a long document's index.html
/// is tens of megabytes — and pushing that through the IPC boundary to render a preview
/// nobody asked to scroll is the same mistake as sending conversion output through the
/// pipe. Above this, the window shows the path instead.
const PREVIEW_LIMIT: u64 = 8 * 1024 * 1024;

/// Read one file from a conversion's output, for previewing.
///
/// **This is a filesystem read reachable from the WebView, so its scope is the whole
/// point.** The path is canonicalised and then checked to be inside the app's own
/// conversions directory; anything else is refused, including a path that only looks
/// like it belongs there. Canonicalising first is what makes `..` in the middle of an
/// otherwise innocent path a refusal rather than an escape.
/// Every directory output is allowed to land in — the app's own, and the folder the
/// person chose if they chose one.
///
/// Both, because a preview has to keep working for conversions made before the setting
/// changed. Public because `deliver.rs` opens what this reads, and two commands that
/// disagree about which paths are in bounds is one of them being wrong.
pub fn output_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(dir) = app.path().app_data_dir() {
        roots.push(dir.join("conversions"));
    }
    if let Some(chosen) = read_output_root(app) {
        roots.push(PathBuf::from(chosen));
    }
    roots
}

#[tauri::command]
pub fn read_output(app: AppHandle, path: String) -> Result<String, String> {
    let roots = output_roots(&app);

    // Both sides canonicalised: a root may itself be reached through a symlink or a
    // short path on Windows, and comparing a canonical child to a non-canonical parent
    // fails for reasons that have nothing to do with safety.
    let file = PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| format!("no such file: {e}"))?;

    let allowed = roots
        .iter()
        .filter_map(|r| r.canonicalize().ok())
        .any(|r| file.starts_with(&r));

    if !allowed {
        return Err("refused: outside the output directories".into());
    }

    let size = std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
    if size > PREVIEW_LIMIT {
        return Err(format!("too large to preview ({} MB)", size / 1024 / 1024));
    }

    std::fs::read_to_string(&file).map_err(|e| format!("could not read: {e}"))
}

/// Where a conversion's output goes.
///
/// Under the app's data directory, one folder per run, named after the document and
/// stamped so a second conversion of the same file does not silently overwrite the
/// first. Sprint 5 replaces this with a folder the person chooses.
#[tauri::command]
pub fn output_dir(
    app: AppHandle,
    writable: tauri::State<'_, crate::workbench::Writable>,
    source: String,
) -> Result<String, String> {
    // The chosen folder if there is one, and the app's own directory otherwise.
    let base = match read_output_root(&app) {
        Some(root) => PathBuf::from(root),
        None => app
            .path()
            .app_data_dir()
            .map_err(|e| format!("no app data directory: {e}"))?
            .join("conversions"),
    };

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

    // A directory this side just made is a place the engine may write to. Registering it
    // here is what keeps the rule in `engine_call` universal rather than a workbench one.
    writable.allow(&dir);

    Ok(dir.to_string_lossy().into_owned())
}
