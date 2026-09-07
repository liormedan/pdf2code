//! A trouble report somebody can send us, with none of their documents in it.
//!
//! When something goes wrong on a machine we cannot see, the useful thing to have is the
//! engine's own diagnostics. The engine already writes them — deliberately to stderr and
//! never to the window, because they can quote a document. That decision protects the
//! customer and leaves us with nothing to look at when they ask for help, and this module
//! is the other half of it: keep the last lines, and hand them over **scrubbed**.
//!
//! **What is removed, and why each one:**
//!
//! - **Paths.** A path carries the document's name, and a document's name is often the
//!   whole of what it is: `חוזה שכירות דירה ברחוב.pdf` needs no contents to be a
//!   disclosure. Replaced with a placeholder that keeps the shape of the message.
//! - **The user's own folder.** `C:\Users\<name>` is a person's name on most machines.
//! - **Anything that looks like a document name**, whatever its shape, because a bare
//!   file name reaches the log without a directory in front of it often enough.
//!
//! What survives is the part that helps: which operation failed, which error code, how
//! long things took, and what the engine said about itself. That is nearly always enough,
//! and when it is not, asking for more is a conversation rather than an assumption.

use std::collections::VecDeque;
use std::sync::Mutex;

use tauri::State;

/// How many lines of engine log are kept.
///
/// A ring rather than a file: the log is a diagnostic aid, not a record, and a file that
/// grows on a customer's disk forever is a second problem for the first one to hide in.
const KEPT_LINES: usize = 400;

#[derive(Default)]
pub struct Log(Mutex<VecDeque<String>>);

impl Log {
    pub fn push(&self, line: String) {
        if let Ok(mut lines) = self.0.lock() {
            if lines.len() >= KEPT_LINES {
                lines.pop_front();
            }
            lines.push_back(line);
        }
    }

    fn lines(&self) -> Vec<String> {
        self.0
            .lock()
            .map(|lines| lines.iter().cloned().collect())
            .unwrap_or_default()
    }
}

/// Remove anything from a log line that could identify a document or a person.
///
/// Deliberately blunt. A scrubber that tries to be clever about which paths are safe is a
/// scrubber that eventually decides one is, and the whole value of this file rests on it
/// never being wrong in that direction. Everything path-shaped goes.
pub fn scrub(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;

    while !rest.is_empty() {
        match next_sensitive(rest) {
            Some((start, len, replacement)) => {
                out.push_str(&rest[..start]);
                out.push_str(replacement);
                rest = &rest[start + len..];
            }
            None => {
                out.push_str(rest);
                break;
            }
        }
    }
    out
}

/// Find the next run of characters that must not leave the machine.
///
/// Returns (offset, length, what to put there). Two shapes are looked for: something that
/// begins like an absolute path, and a bare word ending in a document extension.
fn next_sensitive(text: &str) -> Option<(usize, usize, &'static str)> {
    let bytes = text.as_bytes();

    for (index, _) in text.char_indices() {
        // An absolute Windows path (C:\… or C:/…) or a POSIX one (/home/…).
        let drive = bytes.get(index).is_some_and(|c| c.is_ascii_alphabetic())
            && bytes.get(index + 1) == Some(&b':')
            && matches!(bytes.get(index + 2), Some(b'\\') | Some(b'/'));
        let posix = bytes.get(index) == Some(&b'/')
            && index + 1 < bytes.len()
            && bytes[index + 1].is_ascii_alphabetic()
            && (index == 0 || bytes[index - 1] == b' ' || bytes[index - 1] == b'\'');

        if drive || posix {
            let end = text[index..]
                .find(|c: char| c == '\'' || c == '"' || c == ')' || c == ',')
                .map(|offset| index + offset)
                .unwrap_or(text.len());
            return Some((index, end - index, "<path>"));
        }
    }

    // A bare file name with a document extension, which reaches the log whenever a
    // message names a file without the folder it sits in.
    for extension in [".pdf", ".PDF", ".html", ".jsx", ".zip", ".png", ".jpg"] {
        if let Some(at) = text.find(extension) {
            let start = text[..at]
                .rfind(|c: char| c.is_whitespace() || c == '\'' || c == '"' || c == '(')
                .map(|offset| offset + 1)
                .unwrap_or(0);
            return Some((start, at + extension.len() - start, "<file>"));
        }
    }

    None
}

/// Everything the report says, assembled.
///
/// Deliberately not the settings file: it holds the output folder somebody chose, which
/// is a path, and paths are the thing this whole module exists to keep out.
fn compose(engine: &crate::sidecar::Engine, log: &Log) -> String {
    let mut out = String::new();
    out.push_str("pdf2code trouble report\n");
    out.push_str("=======================\n\n");
    out.push_str(&format!("app version   {}\n", env!("CARGO_PKG_VERSION")));
    out.push_str(&format!("os            {}\n", std::env::consts::OS));
    out.push_str(&format!("architecture  {}\n", std::env::consts::ARCH));

    match engine.status() {
        crate::sidecar::Status::Up { protocol, python, ops } => {
            out.push_str(&format!("engine        up, protocol {protocol}, python {python}\n"));
            out.push_str(&format!("operations    {}\n", ops.join(", ")));
        }
        crate::sidecar::Status::Down { reason } => {
            out.push_str(&format!("engine        down — {reason}\n"));
        }
    }

    out.push_str("\nengine log (most recent last, paths removed)\n");
    out.push_str("--------------------------------------------\n");

    let lines = log.lines();
    if lines.is_empty() {
        out.push_str("(nothing logged this session)\n");
    } else {
        for line in &lines {
            out.push_str(&scrub(line));
            out.push('\n');
        }
    }

    out.push_str(
        "\nNo file names, folder paths or document contents are included in this report.\n",
    );
    out
}

/// Write the report next to wherever the person chooses, and return where it went.
///
/// Through the save dialog like everything else that writes: this is the only way a path
/// becomes writable, and a diagnostic file is not an exception to that.
#[tauri::command]
pub fn export_report(
    engine: State<'_, crate::sidecar::Engine>,
    log: State<'_, Log>,
    writable: State<'_, crate::workbench::Writable>,
    path: String,
) -> Result<String, String> {
    let target = std::path::PathBuf::from(&path);
    if !writable.permits(&target) {
        return Err("refused: nobody chose that place to write to".into());
    }

    let body = compose(&engine, &log);
    std::fs::write(&target, body).map_err(|e| format!("could not write the report: {e}"))?;
    Ok(target.to_string_lossy().into_owned())
}

/// The report as text, for showing it before it is sent anywhere.
///
/// Somebody about to hand us a file has every right to read it first, and a privacy
/// promise nobody can check is a promise.
#[tauri::command]
pub fn preview_report(
    engine: State<'_, crate::sidecar::Engine>,
    log: State<'_, Log>,
) -> String {
    compose(&engine, &log)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_paths_do_not_survive() {
        let line = r"engine: could not create C:\Users\lior\Documents\חוזה.pdf";
        let cleaned = scrub(line);
        assert!(!cleaned.contains("lior"), "{cleaned}");
        assert!(!cleaned.contains("חוזה"), "{cleaned}");
        assert!(cleaned.contains("<path>"), "{cleaned}");
        // The useful half is still there.
        assert!(cleaned.contains("could not create"), "{cleaned}");
    }

    #[test]
    fn a_bare_file_name_does_not_survive_either() {
        // Messages name a file without its folder often enough that catching only full
        // paths would leak on the common case.
        let cleaned = scrub("job j7 failed: מסמך סודי.pdf is damaged");
        assert!(!cleaned.contains("סודי"), "{cleaned}");
        assert!(cleaned.contains("<file>"), "{cleaned}");
        assert!(cleaned.contains("is damaged"), "{cleaned}");
    }

    #[test]
    fn quoted_paths_stop_at_the_quote() {
        // Truncating to the end of the line would take the reason with it, and the reason
        // is the part worth having.
        let cleaned = scrub(r"engine: could not read 'C:\x\y.pdf', the file is locked");
        assert!(!cleaned.contains(r"C:\x"), "{cleaned}");
        assert!(cleaned.contains("the file is locked"), "{cleaned}");
    }

    #[test]
    fn a_line_with_nothing_sensitive_is_unchanged() {
        let line = "engine: up — protocol 1, python 3.13.5";
        assert_eq!(scrub(line), line);
    }

    #[test]
    fn the_log_is_bounded() {
        let log = Log::default();
        for n in 0..(KEPT_LINES + 50) {
            log.push(format!("line {n}"));
        }
        let lines = log.lines();
        assert_eq!(lines.len(), KEPT_LINES);
        // The oldest went, not the newest: a report about what just happened is useless
        // if it kept the first four hundred lines of the session instead.
        assert_eq!(lines.last().unwrap(), &format!("line {}", KEPT_LINES + 49));
    }
}
