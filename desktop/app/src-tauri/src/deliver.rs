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
//! No `shell` plugin and no command interpreter. `Command` is handed its arguments
//! directly and `ShellExecuteW` is handed a path, so at no point is there a command line
//! for a filename to be interpreted inside.

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
pub(crate) fn within(roots: &[PathBuf], real: &Path) -> bool {
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
    // Opening a file is a different operation from showing one, and on Windows it is a
    // different mechanism too. See [`open_with_shell`].
    #[cfg(target_os = "windows")]
    if !select && path.is_file() {
        return open_with_shell(path);
    }

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
            // Only a folder reaches this on Windows now: files were handed to the shell
            // above. Opening a folder is what Explorer is for, so here it is the right
            // program rather than a stand-in for one.
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

/// Open a file with whatever this machine has registered to open it.
///
/// **Not `explorer.exe`.** Explorer's job is folders. Handed a file it forwards it to the
/// registered program through a path that does not preserve every name — which is what a
/// browser opening on `ERR_FILE_NOT_FOUND`, for a file that was sitting right there,
/// looks like from the outside.
///
/// And it could not have been reported. Explorer returns a non-zero exit code on success,
/// so there is nothing to check; `spawn` succeeding says only that Explorer started. **A
/// page that failed to open was indistinguishable from a page that opened**, which is the
/// worse half of the bug: the window said nothing either way.
///
/// `ShellExecuteW` is the documented mechanism for this. It takes the path as UTF-16
/// rather than through any code page, and it returns a value: greater than 32 is success,
/// and anything else is the reason, which is how the window finally has something to say.
///
/// On its own thread, with COM initialised. A registered handler is allowed to be a shell
/// extension, and Tauri's command threads are not an apartment we own. The thread is
/// joined, so the result still comes back to the caller — `ShellExecuteW` returns once the
/// handler has been started, not when it exits.
#[cfg(target_os = "windows")]
fn open_with_shell(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx};
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    // Null-terminated, because the API reads until it finds one. The path arrives from
    // `permitted`, so it has already been canonicalised and proven to be inside a
    // directory output may land in.
    let file: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let verb: Vec<u16> = "open\0".encode_utf16().collect();

    let code = std::thread::spawn(move || unsafe {
        // Ignored on purpose: it fails when the thread already has an apartment, which is
        // not a problem, and `ShellExecuteW` initialises one itself if it has to.
        let _ = CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32);
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        ) as isize
    })
    .join()
    .map_err(|_| "could not open it: the shell call did not finish".to_string())?;

    if code > 32 {
        return Ok(());
    }
    // The four that a person can act on, and the number for everything else. Naming a
    // cause is the whole point of having moved off Explorer.
    Err(match code {
        2 | 3 => "could not open it: the system could not find that path".into(),
        5 => "could not open it: access denied".into(),
        31 => "could not open it: nothing here is registered to open that kind of file".into(),
        other => format!("could not open it: the shell refused it, code {other}"),
    })
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
