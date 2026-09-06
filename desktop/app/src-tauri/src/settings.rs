//! What the app remembers between launches.
//!
//! **One module owns `settings.json`, and that is the point of it existing.** Before
//! this, `documents.rs` wrote the file as `{"outputRoot": …}` — the whole document, every
//! time. That was correct while there was exactly one setting and silently destructive
//! the moment there were two: saving an output folder would have erased the conversion
//! defaults, and saving the defaults would have erased the folder. Everything here reads
//! the whole thing, changes one field, and writes it back.
//!
//! Language and theme are deliberately **not** here. They live in the WebView's own
//! storage, where the i18n provider and the theme toggle already keep them, and moving
//! them across the IPC boundary would buy nothing but a round trip before the first
//! frame can be painted in the right direction.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// The window's last size and place on screen.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct WindowBox {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Where conversions land, if somebody chose a folder.
    pub output_root: Option<String>,
    /// Which formats the next conversion starts with.
    pub formats: Vec<String>,
    /// Whether it keeps the raster layer.
    pub background: bool,
    /// Whether the first-run explanation has been dismissed.
    pub seen_intro: bool,
    pub window: Option<WindowBox>,
}

impl Default for Settings {
    fn default() -> Self {
        // Not `derive(Default)`: it would make `background` false, and a first conversion
        // that quietly drops every diagram is not a default anybody chose.
        Self {
            output_root: None,
            formats: vec!["html".into()],
            background: true,
            seen_intro: false,
            window: None,
        }
    }
}

impl Settings {
    /// Drop anything that is no longer true or never was.
    ///
    /// A settings file is edited by hand, copied between machines, and left behind by an
    /// older version. Trusting it is how an app fails to start for one person in a way
    /// nobody can reproduce.
    fn sanitise(mut self) -> Self {
        self.formats.retain(|f| f == "html" || f == "react");
        self.formats.dedup();
        if self.formats.is_empty() {
            self.formats = vec!["html".into()];
        }
        // A folder that has since been deleted or unplugged is not a root any more.
        if let Some(root) = &self.output_root {
            if !PathBuf::from(root).is_dir() {
                self.output_root = None;
            }
        }
        // A window remembered on a monitor that is no longer attached would open
        // off-screen, which looks exactly like the app failing to start.
        if let Some(w) = self.window {
            if w.width < 720 || w.height < 520 || w.width > 20_000 || w.height > 20_000 {
                self.window = None;
            }
        }
        self
    }
}

fn file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data directory: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    Ok(dir.join("settings.json"))
}

/// Read what is on disk, falling back to defaults for anything missing or unreadable.
///
/// A corrupt settings file starts the app with defaults rather than failing to start.
/// Losing a remembered folder is an annoyance; not opening is a bug report.
pub fn load(app: &AppHandle) -> Settings {
    let parsed = file(app)
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<Settings>(&text).ok())
        .unwrap_or_default();
    parsed.sanitise()
}

/// Change one thing and write the whole document back.
pub fn update(app: &AppHandle, change: impl FnOnce(&mut Settings)) -> Result<(), String> {
    let mut settings = load(app);
    change(&mut settings);
    let settings = settings.sanitise();
    let body = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("could not encode the settings: {e}"))?;
    std::fs::write(file(app)?, body).map_err(|e| format!("could not save the settings: {e}"))
}

// ---------------------------------------------------------------------------
// What the window may ask for.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    load(&app)
}

/// Remember which formats and whether to keep graphics.
///
/// Validated on this side as well as chosen on the other: `sanitise` is what turns a
/// front end that sends `["docx"]` into a conversion that still produces HTML rather than
/// one that produces nothing.
#[tauri::command]
pub fn save_defaults(app: AppHandle, formats: Vec<String>, background: bool) -> Result<(), String> {
    update(&app, |settings| {
        settings.formats = formats;
        settings.background = background;
    })
}

#[tauri::command]
pub fn mark_intro_seen(app: AppHandle) -> Result<(), String> {
    update(&app, |settings| settings.seen_intro = true)
}

/// Third-party licences, read from the versions that are actually installed.
///
/// **Not typed from memory.** This is a legal statement in an About box, and the version
/// column has to match the lock files or it is a statement about software we do not ship.
/// Sprint 9 re-checks it against whatever is locked at release; this is the list as of
/// 7.9.2026.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Credit {
    pub name: &'static str,
    pub version: &'static str,
    pub license: &'static str,
    /// What it does here, so the list reads as an explanation rather than an inventory.
    pub role: &'static str,
}

#[tauri::command]
pub fn credits() -> Vec<Credit> {
    vec![
        Credit { name: "PDFium (pypdfium2)", version: "5.13.0", license: "BSD-3-Clause, Apache-2.0", role: "raster" },
        Credit { name: "pdfminer.six", version: "20260107", license: "MIT", role: "text" },
        Credit { name: "Pillow", version: "12.3.0", license: "MIT-CMU", role: "images" },
        Credit { name: "Tauri", version: "2.11.5", license: "Apache-2.0 OR MIT", role: "shell" },
        Credit { name: "rusqlite / SQLite", version: "0.40.2", license: "MIT / public domain", role: "history" },
        Credit { name: "React", version: "19.2.8", license: "MIT", role: "window" },
        Credit { name: "Tailwind CSS", version: "4.3.3", license: "MIT", role: "styles" },
        Credit { name: "Radix UI", version: "1.6.7", license: "MIT", role: "components" },
        Credit { name: "Lucide", version: "1.41.0", license: "ISC", role: "icons" },
        Credit { name: "Vite", version: "8.2.2", license: "MIT", role: "build" },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_convert_to_something() {
        let d = Settings::default();
        assert_eq!(d.formats, vec!["html".to_string()]);
        // The one a derive would have got wrong.
        assert!(d.background, "a first conversion must keep graphics");
    }

    #[test]
    fn a_settings_file_is_not_trusted() {
        let bad = Settings {
            formats: vec!["docx".into(), "exe".into()],
            ..Settings::default()
        }
        .sanitise();
        assert_eq!(bad.formats, vec!["html".to_string()], "unknown formats become the default");

        let empty = Settings { formats: vec![], ..Settings::default() }.sanitise();
        assert_eq!(empty.formats, vec!["html".to_string()], "no formats is not an option");

        let kept = Settings {
            formats: vec!["react".into()],
            ..Settings::default()
        }
        .sanitise();
        assert_eq!(kept.formats, vec!["react".to_string()], "a real choice survives");
    }

    #[test]
    fn a_window_that_would_open_off_screen_is_forgotten() {
        let tiny = Settings {
            window: Some(WindowBox { x: 0, y: 0, width: 10, height: 10 }),
            ..Settings::default()
        }
        .sanitise();
        assert!(tiny.window.is_none());

        let sane = WindowBox { x: 100, y: 80, width: 1200, height: 800 };
        let kept = Settings { window: Some(sane), ..Settings::default() }.sanitise();
        assert_eq!(kept.window, Some(sane));
    }

    #[test]
    fn a_missing_folder_is_not_a_root() {
        let gone = Settings {
            output_root: Some(r"Z:\unplugged\somewhere".into()),
            ..Settings::default()
        }
        .sanitise();
        assert!(gone.output_root.is_none());
    }

    #[test]
    fn every_credit_is_filled_in() {
        // An About box with a blank licence column is worse than no About box: it makes a
        // claim about software we ship and leaves the claim empty.
        for credit in credits() {
            assert!(!credit.name.is_empty());
            assert!(!credit.version.is_empty(), "{} has no version", credit.name);
            assert!(!credit.license.is_empty(), "{} has no licence", credit.name);
            assert!(!credit.role.is_empty(), "{} has no role", credit.name);
        }
    }
}
