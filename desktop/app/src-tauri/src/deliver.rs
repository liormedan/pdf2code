//! Handing the output over.
//!
//! A conversion writes files and the window shows a path. Until this module existed that
//! was the end of it — the person could read where their code was and not reach it. Three
//! commands close that: list what was written, open it, and show it in the file manager.
//!
//! **All three hand a path to the operating system, so the scope is the whole point.** A
//! path is acceptable here only if it is inside a directory output is allowed to land in,
//! or one a native dialog produced. That is the same rule `read_output` and
//! [`crate::workbench::Writable`] already enforce, reused rather than restated.
//!
//! **Files carry a second check that directories do not: an extension allowlist.** An
//! output root is a folder the person picked, and it may contain anything — so a command
//! that opens any file inside it is a command that runs any program inside it. Directories
//! open freely; files open only if they are something this app could plausibly have
//! written.
//!
//! No `shell` plugin and no shell at all. `Command` is handed its arguments directly, so
//! there is no string for a filename to be interpreted inside.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::documents::output_roots;
use crate::workbench::Writable;

/// What a file has to be for us to hand it to the operating system.
///
/// Everything a conversion or an export writes, and nothing that runs. `.exe`, `.bat`,
/// `.ps1`, `.lnk` and their friends are absent on purpose, and absent by default: this is
/// a list of what is allowed, not a list of what is blocked.
const OPENABLE: &[&str] = &[
    "html", "htm", "css", "js", "jsx", "ts", "tsx", "json", "md", "txt", "svg", "png", "jpg",
    "jpeg", "webp", "pdf", "zip",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutFile {
    pub name: String,
    pub size: u64,
}

/// Whether the window may name this path at all.
fn permitted(app: &AppHandle, writable: &Writable, path: &Path) -> bool {
    let Ok(real) = path.canonicalize() else {
        // A path that does not resolve is a path we will not hand to the desktop. These
        // three commands only ever name things that already exist.
        return false;
    };
    within(&output_roots(app), &real) || writable.permits(&real)
}

/// Whether a resolved path is inside one of these roots.
///
/// Split out from [`permitted`] so it can be tested without an app: the roots come from
/// somewhere else, but **this is the comparison that decides whether a path escapes**,
/// and a scope check that is only exercised by running the whole program is a scope check
/// nobody exercises.
fn within(roots: &[PathBuf], real: &Path) -> bool {
    roots
        .iter()
        .filter_map(|root| root.canonicalize().ok())
        .any(|root| real.starts_with(&root))
}

/// What a conversion actually wrote, with sizes.
///
/// `convert` returns file names; the window showed them and could not say how big any of
/// them was. A 40MB `index.html` and a 40KB one are different products, and the person
/// deciding whether to send one to a colleague needs the number.
#[tauri::command]
pub fn list_output(
    app: AppHandle,
    writable: State<'_, Writable>,
    dir: String,
) -> Result<Vec<OutFile>, String> {
    let dir = PathBuf::from(&dir);
    if !permitted(&app, &writable, &dir) {
        return Err("refused: outside the output directories".into());
    }

    let mut files: Vec<OutFile> = std::fs::read_dir(&dir)
        .map_err(|e| format!("could not read the folder: {e}"))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let meta = entry.metadata().ok()?;
            // One level. A conversion writes flat, and recursing would turn a listing
            // into a walk of whatever the person's chosen output root contains.
            if !meta.is_file() {
                return None;
            }
            Some(OutFile {
                name: entry.file_name().to_string_lossy().into_owned(),
                size: meta.len(),
            })
        })
        .collect();

    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

/// Open a folder, or a file in whatever the system opens it with.
#[tauri::command]
pub fn open_path(
    app: AppHandle,
    writable: State<'_, Writable>,
    path: String,
) -> Result<(), String> {
    let path = PathBuf::from(&path);
    if !permitted(&app, &writable, &path) {
        return Err("refused: outside the output directories".into());
    }

    if path.is_file() {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .unwrap_or_default();
        if !OPENABLE.contains(&ext.as_str()) {
            return Err(format!("refused: this app does not open .{ext} files"));
        }
    }

    launch(&path, false)
}

/// Show the file in the file manager, selected, rather than opening it.
#[tauri::command]
pub fn reveal_path(
    app: AppHandle,
    writable: State<'_, Writable>,
    path: String,
) -> Result<(), String> {
    let path = PathBuf::from(&path);
    if !permitted(&app, &writable, &path) {
        return Err("refused: outside the output directories".into());
    }
    launch(&path, true)
}

/// Hand the path to the desktop environment.
///
/// Spawned without a shell: the path is one argument, not part of a command line, so a
/// document called `& del *.*` is a filename and stays one.
fn launch(path: &Path, select: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = Command::new("explorer.exe");
        if select {
            // `/select,` takes the path joined to the switch — one argument, comma and
            // all. Explorer is also documented to return a non-zero exit code on success,
            // which is why nothing below waits on it.
            let mut arg = std::ffi::OsString::from("/select,");
            arg.push(path.as_os_str());
            c.arg(arg);
        } else {
            c.arg(path.as_os_str());
        }
        c
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = Command::new("open");
        if select {
            c.arg("-R");
        }
        c.arg(path.as_os_str());
        c
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut c = Command::new("xdg-open");
        // No portable "select the file" on Linux, so revealing opens the folder holding
        // it. Better than doing nothing and better than pretending.
        let target = if select {
            path.parent().unwrap_or(path)
        } else {
            path
        };
        c.arg(target.as_os_str());
        c
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("could not open it: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_allowlist_admits_what_we_write_and_nothing_that_runs() {
        for ok in ["html", "css", "jsx", "md", "png", "zip", "pdf"] {
            assert!(OPENABLE.contains(&ok), "{ok} should be openable");
        }
        // The point of the list. An output root is a folder the person picked, and it
        // may hold anything at all.
        for no in ["exe", "bat", "cmd", "ps1", "lnk", "scr", "msi", "dll", "vbs"] {
            assert!(!OPENABLE.contains(&no), "{no} must not be openable");
        }
    }

    /// Two directories where one name is a prefix of the other, which is the shape that
    /// makes a naive `starts_with` on strings wrong.
    fn sibling_roots() -> (PathBuf, PathBuf) {
        let base = std::env::temp_dir().join("pdf2code-scope-test");
        let inside = base.join("conversions");
        let next_door = base.join("conversions-elsewhere");
        std::fs::create_dir_all(inside.join("run-1")).unwrap();
        std::fs::create_dir_all(&next_door).unwrap();
        (inside, next_door)
    }

    #[test]
    fn a_path_inside_a_root_is_in_scope_and_one_beside_it_is_not() {
        let (inside, next_door) = sibling_roots();
        let roots = vec![inside.clone()];

        let file = inside.join("run-1").join("index.html");
        std::fs::write(&file, "<p>x</p>").unwrap();
        assert!(within(&roots, &file.canonicalize().unwrap()));

        // `conversions-elsewhere` starts with `conversions` as a string and is a
        // different directory. Comparing components rather than characters is what makes
        // this a refusal.
        let outside = next_door.join("theirs.html");
        std::fs::write(&outside, "<p>x</p>").unwrap();
        assert!(!within(&roots, &outside.canonicalize().unwrap()));

        // And the classic: a path that walks back out of the root it started in.
        let escaped = inside.join("..").join("conversions-elsewhere").join("theirs.html");
        assert!(!within(&roots, &escaped.canonicalize().unwrap()));

        let _ = std::fs::remove_dir_all(std::env::temp_dir().join("pdf2code-scope-test"));
    }

    #[test]
    fn no_roots_means_nothing_is_in_scope() {
        // The state on a machine where the app data directory could not be resolved. It
        // should refuse everything rather than fall open.
        let file = std::env::temp_dir();
        assert!(!within(&[], &file.canonicalize().unwrap()));
    }

    #[test]
    fn the_allowlist_is_lowercase_so_the_comparison_can_be() {
        // `open_path` lowercases the extension before looking it up, which only works
        // if nothing here is capitalised. `.HTML` is a real filename on Windows.
        for entry in OPENABLE {
            assert_eq!(*entry, entry.to_ascii_lowercase());
        }
    }
}
