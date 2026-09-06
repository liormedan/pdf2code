//! The workbench: what the window may write, and how it sees a page.
//!
//! Two problems live here, and both are the same problem the rest of this side already
//! solves — the window names what it wants, and this side decides whether it is allowed.
//!
//! **The first is writing.** The converter's output landed wherever `output_dir` said,
//! and `output_dir` is ours. The workbench is different: saving an edited document means
//! the engine writes to a path somebody chose, and `engine_call` forwards whatever the
//! front end puts in `args`. A window that can name any `out` has a **write primitive at
//! an arbitrary path**, through an engine that is only too happy to create directories.
//! So every writable path is registered here first — by a native save dialog, by a folder
//! picker, or by `output_dir` creating one of our own — and [`Writable::permits`] is
//! checked in `engine_call` before the engine ever sees the request.
//!
//! **The second is seeing.** A page view needs images, and the WebView has no filesystem.
//! Thumbnails go to a scratch directory under the app's own data, and [`read_image`]
//! hands one back as a data URI, refusing anything outside it. Base64 through the IPC
//! boundary rather than Tauri's asset protocol: a 160px page is about ten kilobytes, they
//! are fetched only as they scroll into view, and this adds no new protocol for a
//! document to reach through. If a page view of a thousand-page book ever feels slow,
//! `asset:` is already permitted by the CSP and this is the thing to revisit.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// Every path the engine is allowed to write to, and nothing else.
///
/// Files and directories both: a save dialog blesses one file, a folder picker blesses
/// everything under one directory. It lives only as long as the app runs, because it is
/// not a permission somebody granted — it is a record of what they just chose.
#[derive(Default)]
pub struct Writable(Mutex<HashSet<PathBuf>>);

impl Writable {
    pub fn allow(&self, path: &Path) {
        if let Ok(mut set) = self.0.lock() {
            set.insert(settle(path));
        }
    }

    /// Whether the engine may write here: the exact path somebody chose, or anything
    /// inside a directory they chose.
    pub fn permits(&self, path: &Path) -> bool {
        let Ok(set) = self.0.lock() else { return false };
        let path = settle(path);
        set.iter()
            .any(|allowed| path == *allowed || path.starts_with(allowed))
    }
}

/// A canonical form for a path that **does not exist yet**.
///
/// `canonicalize` fails on a file a save dialog has only named, so this walks up to the
/// nearest ancestor that does exist, canonicalises that, and puts the rest back. Walking
/// rather than checking only the parent: the engine creates directories on its way to an
/// output, so `chosen/thumbs/page-1.png` has two levels that are not there yet — and
/// checking one level deep refused a write somebody had actually chosen. Found by the
/// test below, not by using it.
///
/// Resolving is also what makes `chosen/../../elsewhere.pdf` collapse to where it really
/// points, rather than slip past a string comparison.
fn settle(path: &Path) -> PathBuf {
    if let Ok(real) = path.canonicalize() {
        return real;
    }

    let mut rest: Vec<&std::ffi::OsStr> = Vec::new();
    let mut here = path;
    while let (Some(parent), Some(name)) = (here.parent(), here.file_name()) {
        rest.push(name);
        if let Ok(mut settled) = parent.canonicalize() {
            for part in rest.iter().rev() {
                settled.push(part);
            }
            return settled;
        }
        here = parent;
    }

    path.to_path_buf()
}

/// Choose where an edited document is saved.
///
/// The only way a file path becomes writable. `None` means the person cancelled, which
/// is an answer rather than an error.
#[tauri::command]
pub fn pick_save_path(
    app: AppHandle,
    writable: State<'_, Writable>,
    name: String,
) -> Option<String> {
    let chosen = app
        .dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .set_file_name(&name)
        .blocking_save_file()?;

    let path: PathBuf = chosen.into_path().ok()?;
    writable.allow(&path);
    Some(path.to_string_lossy().into_owned())
}

/// Choose a folder to export page images into.
#[tauri::command]
pub fn pick_export_dir(app: AppHandle, writable: State<'_, Writable>) -> Option<String> {
    let folder = app.dialog().file().blocking_pick_folder()?;
    let path: PathBuf = folder.into_path().ok()?;
    writable.allow(&path);
    Some(path.to_string_lossy().into_owned())
}

/// The scratch directory a document's thumbnails go into.
///
/// `slot` is minted by the window, and it is checked rather than trusted: letters, digits
/// and dashes only. A slot is the one string from the front end that becomes part of a
/// path on this side, so it is the one string that has to be boring.
#[tauri::command]
pub fn workbench_dir(
    app: AppHandle,
    writable: State<'_, Writable>,
    slot: String,
) -> Result<String, String> {
    if slot.is_empty()
        || slot.len() > 64
        || !slot.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("bad slot".into());
    }

    let dir = scratch(&app)?.join(slot);
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    writable.allow(&dir);
    Ok(dir.to_string_lossy().into_owned())
}

/// A thumbnail, as a data URI.
///
/// Scoped to the scratch directory and nowhere else — this is a filesystem read reachable
/// from the WebView, so its scope is the whole point, exactly as in `read_output`.
#[tauri::command]
pub fn read_image(app: AppHandle, path: String) -> Result<String, String> {
    const LIMIT: u64 = 4 * 1024 * 1024;

    let root = scratch(&app)?
        .canonicalize()
        .map_err(|e| format!("no scratch directory: {e}"))?;
    let file = PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| format!("no such image: {e}"))?;

    if !file.starts_with(&root) {
        return Err("refused: outside the workbench directory".into());
    }
    if std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0) > LIMIT {
        return Err("image too large".into());
    }

    let mime = match file.extension().and_then(|e| e.to_str()) {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        _ => "image/png",
    };
    let bytes = std::fs::read(&file).map_err(|e| format!("could not read: {e}"))?;
    Ok(format!("data:{mime};base64,{}", base64(&bytes)))
}

fn scratch(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data directory: {e}"))?
        .join("workbench");
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Throw away last run's thumbnails.
///
/// Called at startup. They are a rendering of a document somebody opened, so leaving them
/// behind is both clutter and a small disclosure; clearing at launch rather than at exit
/// means a crash does not leave them either.
pub fn clear_scratch(app: &AppHandle) {
    if let Ok(dir) = scratch(app) {
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// Base64, written out rather than depended on.
///
/// Twenty lines against a crate in an installer shipped to a customer who bought on
/// "nothing leaves this machine" — the dependency list is part of what they are told, and
/// this is not worth a line on it.
fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(ALPHABET[(n >> 18 & 63) as usize] as char);
        out.push(ALPHABET[(n >> 12 & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(n >> 6 & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_the_standard() {
        // The three padding cases, which is where a hand-written encoder goes wrong.
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foob"), "Zm9vYg==");
        assert_eq!(base64(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        // A PNG header: bytes above 127, where a signed-byte mistake would show.
        assert_eq!(base64(&[0x89, 0x50, 0x4E, 0x47]), "iVBORw==");
    }

    #[test]
    fn nothing_is_writable_until_it_is_chosen() {
        let writable = Writable::default();
        let dir = std::env::temp_dir();
        assert!(!writable.permits(&dir.join("anywhere.pdf")));

        writable.allow(&dir.join("chosen.pdf"));
        assert!(writable.permits(&dir.join("chosen.pdf")));
        assert!(!writable.permits(&dir.join("not-chosen.pdf")));
    }

    #[test]
    fn a_chosen_folder_covers_what_is_in_it_and_nothing_above_it() {
        let writable = Writable::default();
        let root = std::env::temp_dir().join("pdf2code-writable-test");
        std::fs::create_dir_all(&root).unwrap();

        writable.allow(&root);
        assert!(writable.permits(&root.join("page-1.png")));
        // Two levels that do not exist yet, which is exactly what the engine creates on
        // its way to writing thumbnails into a folder somebody picked.
        assert!(writable.permits(&root.join("deeper").join("still-deeper").join("page-1.png")));
        // The escape a string comparison would have missed.
        assert!(!writable.permits(&root.join("..").join("elsewhere.pdf")));

        let _ = std::fs::remove_dir_all(&root);
    }
}
