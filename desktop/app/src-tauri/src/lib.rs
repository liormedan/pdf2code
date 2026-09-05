//! The Rust side of the window.
//!
//! Deliberately almost empty. This is the shell sprint: the goal is an installer that
//! runs on a machine that is not ours, and every line of Rust added before that is
//! proven is a line that makes proving it harder.
//!
//! What lands here next, in order:
//!   * sprint 2 — spawning the Python sidecar, framing newline-delimited JSON over its
//!     stdin/stdout, and forwarding `progress` to the window as Tauri events. No local
//!     HTTP server: see desktop/architecture.md §2 for why that is a product decision
//!     and not a stylistic one.
//!   * sprint 5 — the file dialog and the project database. Note that both live *here*
//!     rather than in the WebView: the front end never touches the disk, it names paths
//!     and this side decides what may be done with them.

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
        .invoke_handler(tauri::generate_handler![app_version])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
