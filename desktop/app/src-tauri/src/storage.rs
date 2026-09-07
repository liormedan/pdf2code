//! How much disk the app's own output is using, and cleaning it up.
//!
//! **Scoped to the app's own conversions folder, and nowhere else.** If somebody chose an
//! output root in a native dialog, that folder is theirs — they picked it in Explorer, and
//! a "clean old output" button that deletes things from it is a button that deletes things
//! from a place we were not asked to manage. The app's own `conversions` directory under
//! `app_data_dir` is different: it exists only because we put it there, one folder per run,
//! and it is exactly the kind of thing that quietly grows on a machine nobody revisits.
//!
//! **A folder still named in the history is never removed**, however old it is. Cleaning
//! disk space and forgetting a project are two different actions with two different
//! buttons, and a person who cleaned up old files should not discover that "Open" on a
//! project from last month now points at nothing.
//!
//! The two `#[tauri::command]`s below are thin: they fetch a root and the set of
//! referenced paths, then hand both to [`summarize`] and [`clean`], which take a `Path`
//! and a list rather than an `AppHandle`. That split is what lets the tests below exercise
//! real directories and real ages without a mock application.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::deliver::within;
use crate::projects::Store;

fn conversions_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data directory: {e}"))?
        .join("conversions"))
}

/// Every `out` directory still named in the history, resolved so a symlink or a short
/// Windows path cannot slip a folder past the comparison.
fn referenced(store: &Store) -> Result<Vec<PathBuf>, String> {
    let connection = store.0.lock().map_err(|_| "project store is poisoned")?;
    let mut statement = connection
        .prepare("SELECT out FROM projects")
        .map_err(|e| format!("could not read the project store: {e}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("could not read the project store: {e}"))?;

    Ok(rows
        .filter_map(Result::ok)
        .filter_map(|out| PathBuf::from(out).canonicalize().ok())
        .collect())
}

/// One directory under `conversions/`, with what a person needs to decide about it.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OutputFolder {
    pub name: String,
    pub path: String,
    pub bytes: u64,
    /// Days since it was last written to.
    pub age_days: u32,
    /// Still named in the history — cleaning never touches this one.
    pub referenced: bool,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StorageSummary {
    pub path: String,
    pub bytes: u64,
    pub folders: Vec<OutputFolder>,
}

fn dir_bytes(dir: &Path) -> u64 {
    // One level: a conversion writes flat, and this is disk accounting, not a listing
    // that has to be exact to the byte if something odd is nested in there.
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| entry.metadata().ok())
        .filter(|meta| meta.is_file())
        .map(|meta| meta.len())
        .sum()
}

fn age_days(dir: &Path) -> u32 {
    std::fs::metadata(dir)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .map(|elapsed| (elapsed.as_secs() / 86_400) as u32)
        .unwrap_or(0)
}

/// What is sitting under `root` right now, given which paths the history still names.
///
/// Read for the settings screen, so "clean old output" is a decision made with numbers in
/// front of it rather than a button pressed on faith. Sorted oldest first, so the folders
/// most worth clearing are the ones on top.
fn summarize(root: &Path, kept: &[PathBuf]) -> StorageSummary {
    let mut folders: Vec<OutputFolder> = std::fs::read_dir(root)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| entry.metadata().map(|m| m.is_dir()).unwrap_or(false))
        .map(|entry| {
            let path = entry.path();
            let real = path.canonicalize().unwrap_or_else(|_| path.clone());
            OutputFolder {
                name: entry.file_name().to_string_lossy().into_owned(),
                bytes: dir_bytes(&path),
                age_days: age_days(&path),
                referenced: kept.contains(&real),
                path: path.to_string_lossy().into_owned(),
            }
        })
        .collect();

    folders.sort_by(|a, b| b.age_days.cmp(&a.age_days));

    StorageSummary {
        path: root.to_string_lossy().into_owned(),
        bytes: folders.iter().map(|f| f.bytes).sum(),
        folders,
    }
}

#[tauri::command]
pub fn storage_summary(app: AppHandle, store: State<'_, Store>) -> Result<StorageSummary, String> {
    let root = conversions_root(&app)?;
    let kept = referenced(&store)?;
    Ok(summarize(&root, &kept))
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CleanResult {
    pub removed: u32,
    pub freed_bytes: u64,
    /// Old enough to qualify, but left alone because history still names it.
    pub kept_referenced: u32,
}

/// The one decision this command makes, pulled out so it can be tested without touching a
/// filesystem at all: old enough, and not named in the history.
fn should_remove(age_days: u32, threshold_days: u32, referenced: bool) -> bool {
    age_days >= threshold_days && !referenced
}

/// Delete conversion folders directly under `root` that are older than `older_than_days`,
/// except ones `kept` still names.
///
/// Every path removed is checked with the same [`within`] the delivery commands use, so
/// this can never touch a path outside `root` — belt and suspenders over a function that
/// deletes things, and free once `root` is always `conversions_root`.
fn clean(root: &Path, kept: &[PathBuf], older_than_days: u32) -> Result<CleanResult, String> {
    let root_real = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());

    let mut removed = 0u32;
    let mut freed = 0u64;
    let mut kept_referenced = 0u32;

    let entries = std::fs::read_dir(root)
        .map_err(|e| format!("could not read {}: {e}", root.display()))?;

    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if !entry.metadata().map(|m| m.is_dir()).unwrap_or(false) {
            continue;
        }
        let real = match path.canonicalize() {
            Ok(real) => real,
            Err(_) => continue,
        };
        // Never a path outside the folder we were asked to clean, regardless of what the
        // age and reference checks below decide.
        if !within(&[root_real.clone()], &real) {
            continue;
        }

        let is_referenced = kept.contains(&real);
        let age = age_days(&path);
        if !should_remove(age, older_than_days, is_referenced) {
            if is_referenced && age >= older_than_days {
                kept_referenced += 1;
            }
            continue;
        }

        let bytes = dir_bytes(&path);
        if std::fs::remove_dir_all(&path).is_ok() {
            removed += 1;
            freed += bytes;
        }
    }

    Ok(CleanResult { removed, freed_bytes: freed, kept_referenced })
}

#[tauri::command]
pub fn clean_old_output(
    app: AppHandle,
    store: State<'_, Store>,
    older_than_days: u32,
) -> Result<CleanResult, String> {
    let root = conversions_root(&app)?;
    let kept = referenced(&store)?;
    clean(&root, &kept, older_than_days)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::Duration;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pdf2code-storage-test-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Back-date a directory's modified time by `days`.
    ///
    /// `File::open` on Windows grants read access only, and `set_modified` needs
    /// `FILE_WRITE_ATTRIBUTES` — so a plain handle is refused with access denied, found
    /// by running this rather than by reading the standard library docs closely enough.
    /// `FILE_FLAG_BACKUP_SEMANTICS` (0x0200_0000) is what lets a directory be opened as a
    /// handle at all; this ships for Windows only today, so the flag is written out
    /// rather than pulled in via a crate for one test helper.
    #[cfg(windows)]
    fn age(dir: &Path, days: u64) {
        use std::os::windows::fs::OpenOptionsExt;

        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
        let past = SystemTime::now() - Duration::from_secs(days * 86_400 + 3_600);
        let file = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
            .open(dir)
            .expect("open directory as a writable handle");
        file.set_modified(past).expect("back-date the directory");
    }

    #[cfg(not(windows))]
    fn age(dir: &Path, days: u64) {
        let past = SystemTime::now() - Duration::from_secs(days * 86_400 + 3_600);
        let file = fs::File::open(dir).expect("open directory as a handle");
        file.set_modified(past).expect("back-date the directory");
    }

    #[test]
    fn dir_bytes_sums_files_and_ignores_subdirectories() {
        let dir = scratch("bytes");
        fs::write(dir.join("index.html"), b"0123456789").unwrap();
        fs::write(dir.join("style.css"), b"01234").unwrap();
        fs::create_dir(dir.join("nested")).unwrap();
        fs::write(dir.join("nested").join("ignored.txt"), b"xxxxxxxxxxxxxxxxxxxx").unwrap();

        assert_eq!(dir_bytes(&dir), 15);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_referenced_folder_is_never_removed_no_matter_how_old() {
        // The property that matters most: history and disk cleanup must never disagree
        // about whether a folder still exists. A person who cleaned up old files should
        // not discover that "open" on a month-old project now points at nothing.
        assert!(!should_remove(9999, 30, true));
    }

    #[test]
    fn a_young_unreferenced_folder_is_kept() {
        assert!(!should_remove(1, 30, false));
    }

    #[test]
    fn an_old_unreferenced_folder_is_removed() {
        assert!(should_remove(30, 30, false));
        assert!(should_remove(31, 30, false));
    }

    #[test]
    fn the_threshold_is_a_boundary_not_a_suggestion() {
        assert!(!should_remove(29, 30, false));
        assert!(should_remove(30, 30, false));
    }

    /// The real test: three actual directories on disk, one of them named in the history,
    /// cleaned with a real threshold. This is what a settings-screen click actually does,
    /// exercised without a WebView in front of it.
    #[test]
    fn cleaning_removes_the_old_unreferenced_folder_and_nothing_else() {
        let root = scratch("clean");

        let old_gone = root.join("report-1");
        fs::create_dir_all(&old_gone).unwrap();
        fs::write(old_gone.join("index.html"), vec![b'x'; 1_000]).unwrap();
        age(&old_gone, 45);

        let old_kept = root.join("report-2");
        fs::create_dir_all(&old_kept).unwrap();
        fs::write(old_kept.join("index.html"), vec![b'x'; 2_000]).unwrap();
        age(&old_kept, 90);
        let old_kept_real = old_kept.canonicalize().unwrap();

        let young = root.join("report-3");
        fs::create_dir_all(&young).unwrap();
        fs::write(young.join("index.html"), vec![b'x'; 3_000]).unwrap();
        // Freshly created: age 0, well under the threshold.

        let summary = summarize(&root, &[old_kept_real.clone()]);
        assert_eq!(summary.folders.len(), 3, "{:?}", summary.folders);
        assert_eq!(summary.bytes, 6_000);
        assert!(
            summary.folders.iter().find(|f| f.name == "report-2").unwrap().referenced,
            "the folder still named in history must be reported as referenced"
        );

        let result = clean(&root, &[old_kept_real], 30).unwrap();
        assert_eq!(result.removed, 1, "only the old, unreferenced folder is removed");
        assert_eq!(result.freed_bytes, 1_000);
        assert_eq!(result.kept_referenced, 1);

        assert!(!old_gone.exists(), "the old unreferenced folder is gone");
        assert!(old_kept.exists(), "the referenced folder survives, however old");
        assert!(young.exists(), "the young folder survives, referenced or not");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cleaning_never_reaches_outside_the_root_it_was_given() {
        // A defence-in-depth check on `within`, exercised the way `clean` actually calls
        // it: a sibling directory that shares a name prefix must never be touched, even if
        // some future bug fed it in as a candidate.
        let base = scratch("escape-base");
        let root = base.join("conversions");
        let sibling = base.join("conversions-elsewhere");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&sibling).unwrap();
        fs::write(sibling.join("keep.txt"), b"do not touch").unwrap();

        let result = clean(&root, &[], 0).unwrap();
        assert_eq!(result.removed, 0, "there was nothing inside root to remove");
        assert!(sibling.join("keep.txt").exists(), "the sibling directory is untouched");

        let _ = fs::remove_dir_all(&base);
    }
}
