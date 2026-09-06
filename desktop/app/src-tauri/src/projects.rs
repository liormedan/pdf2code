//! What was converted, and where the result went.
//!
//! **Paths, never contents.** The database records that a document at a path was
//! converted with certain settings and that its output landed in a directory. It does
//! not hold the document, a copy of it, or anything extracted from it. That is the same
//! promise the web app made and it survives the move to desktop unchanged — a history
//! file that quietly accumulated people's contracts would be the one thing this product
//! cannot afford.
//!
//! **No SQL crosses the IPC boundary.** The window calls `record_project`,
//! `list_projects` and `forget_project`; it never sends a query. A front end that can
//! send SQL is a front end that can read any table, and the whole point of putting the
//! store on this side is that it decides what may be asked.
//!
//! SQLite is bundled rather than borrowed from the system. An installed application
//! cannot depend on a library the machine may not have, and "works on the developer's
//! computer" is precisely the failure sprint 1 exists to prevent.

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

pub struct Store(pub Mutex<Connection>);

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: i64,
    /// Where the source document was when it was converted. It may have moved since,
    /// which is exactly what a re-run has to notice.
    pub source: String,
    pub name: String,
    /// Bytes at conversion time. Compared on a re-run: same name and a different size
    /// is a different document wearing the same label.
    pub size: u64,
    pub pages: u32,
    pub out: String,
    /// Comma-separated, because two values do not earn a join table.
    pub formats: String,
    pub lang: String,
    /// Unix seconds.
    pub converted_at: i64,
}

pub fn open(app: &AppHandle) -> Result<Connection, String> {
    let dir: PathBuf = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data directory: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;

    let connection = Connection::open(dir.join("projects.db"))
        .map_err(|e| format!("could not open the project store: {e}"))?;

    // Written on every open rather than versioned: one table, and `IF NOT EXISTS` is
    // the whole migration story until there is a second version to migrate from.
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS projects (
                 id            INTEGER PRIMARY KEY AUTOINCREMENT,
                 source        TEXT    NOT NULL,
                 name          TEXT    NOT NULL,
                 size          INTEGER NOT NULL,
                 pages         INTEGER NOT NULL,
                 out           TEXT    NOT NULL,
                 formats       TEXT    NOT NULL,
                 lang          TEXT    NOT NULL,
                 converted_at  INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS projects_recent ON projects (converted_at DESC);",
        )
        .map_err(|e| format!("could not prepare the project store: {e}"))?;

    Ok(connection)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProject {
    pub source: String,
    pub name: String,
    pub size: u64,
    pub pages: u32,
    pub out: String,
    pub formats: String,
    pub lang: String,
}

#[tauri::command]
pub fn record_project(store: State<'_, Store>, project: NewProject) -> Result<i64, String> {
    let connection = store.0.lock().map_err(|_| "project store is poisoned")?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    connection
        .execute(
            "INSERT INTO projects (source, name, size, pages, out, formats, lang, converted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                project.source,
                project.name,
                project.size as i64,
                project.pages,
                project.out,
                project.formats,
                project.lang,
                now
            ],
        )
        .map_err(|e| format!("could not record the project: {e}"))?;

    Ok(connection.last_insert_rowid())
}

#[tauri::command]
pub fn list_projects(store: State<'_, Store>, limit: Option<u32>) -> Result<Vec<Project>, String> {
    let connection = store.0.lock().map_err(|_| "project store is poisoned")?;
    let mut statement = connection
        .prepare(
            "SELECT id, source, name, size, pages, out, formats, lang, converted_at
             FROM projects ORDER BY converted_at DESC, id DESC LIMIT ?1",
        )
        .map_err(|e| format!("could not read the project store: {e}"))?;

    let rows = statement
        .query_map([limit.unwrap_or(200)], |row| {
            Ok(Project {
                id: row.get(0)?,
                source: row.get(1)?,
                name: row.get(2)?,
                size: row.get::<_, i64>(3)? as u64,
                pages: row.get(4)?,
                out: row.get(5)?,
                formats: row.get(6)?,
                lang: row.get(7)?,
                converted_at: row.get(8)?,
            })
        })
        .map_err(|e| format!("could not read the project store: {e}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("could not read the project store: {e}"))
}

/// Remove a row.
///
/// Named `forget` rather than `delete` because that is all it does: the conversion's
/// output stays on disk. Deleting somebody's files because they tidied a list is a
/// surprise, and an irreversible one.
#[tauri::command]
pub fn forget_project(store: State<'_, Store>, id: i64) -> Result<(), String> {
    let connection = store.0.lock().map_err(|_| "project store is poisoned")?;
    connection
        .execute("DELETE FROM projects WHERE id = ?1", params![id])
        .map_err(|e| format!("could not forget the project: {e}"))?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceState {
    pub exists: bool,
    /// True when the file is there but no longer the one that was converted.
    pub changed: bool,
    pub size: u64,
}

/// Whether a project's source is still where it was, and still the same file.
///
/// A re-run needs both answers and they are different: a missing file needs the person
/// to find it again, while a file that is present but a different size is a document
/// that was edited under a saved project — converting it silently would produce output
/// that does not match what the history says it is.
#[tauri::command]
pub fn source_state(source: String, recorded_size: u64) -> SourceState {
    match std::fs::metadata(&source) {
        Ok(meta) => SourceState {
            exists: true,
            // Size only. A hash would be certain and would also mean reading the whole
            // document to answer a question asked while somebody waits — and the case
            // this needs to catch is an edited file, which almost never keeps its
            // length to the byte.
            changed: recorded_size > 0 && meta.len() != recorded_size,
            size: meta.len(),
        },
        Err(_) => SourceState { exists: false, changed: false, size: 0 },
    }
}
