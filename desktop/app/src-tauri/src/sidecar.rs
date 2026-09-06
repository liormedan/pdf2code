//! The engine process, and the only door to it.
//!
//! The window never spawns anything and never sees a pipe. It calls two commands, and
//! progress comes back as an event. That boundary is the whole point: a WebView that
//! renders markup built from documents nobody vetted has no business holding a handle
//! to a process.
//!
//! Newline-delimited JSON over the child's stdin and stdout — no local HTTP server, for
//! the reason in desktop/architecture.md §2. The reader lives on its own thread because
//! a cancel has to be *writable* while a job is running, which a single-threaded
//! request/response loop cannot do.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;

/// Emitted for every `progress` line the engine writes. The payload is passed through
/// unchanged: `page`, `pages` and `phase` are the shapes src/converter/types.ts already
/// defined and the front end already knows how to render.
const PROGRESS_EVENT: &str = "engine://progress";

/// Emitted once when the engine announces itself, and again if it dies.
const STATUS_EVENT: &str = "engine://status";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum Status {
    /// Not started, or started and gone. `reason` is for the log and the status bar,
    /// never for a dialog — a missing engine is a state, not an incident.
    Down { reason: String },
    Up { protocol: u32, python: String, ops: Vec<String> },
}

pub struct Engine {
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    status: Arc<Mutex<Status>>,
    next_id: AtomicU64,
}

impl Engine {
    pub fn new() -> Self {
        Self {
            stdin: Mutex::new(None),
            child: Mutex::new(None),
            pending: Arc::new(Mutex::new(HashMap::new())),
            status: Arc::new(Mutex::new(Status::Down {
                reason: "not started".into(),
            })),
            next_id: AtomicU64::new(1),
        }
    }

    pub fn status(&self) -> Status {
        self.status.lock().unwrap().clone()
    }

    /// Start the engine, or record why it could not start.
    ///
    /// Never returns an error to the caller. A window that refuses to open because a
    /// sidecar is missing is worse than a window that opens and says so — and during
    /// sprint 2 the packaged binary genuinely does not exist yet.
    pub fn start(&self, app: &AppHandle) {
        match self.spawn(app) {
            Ok(()) => eprintln!("engine: spawned, waiting for it to announce itself"),
            Err(reason) => {
                eprintln!("engine: down — {reason}");
                *self.status.lock().unwrap() = Status::Down { reason: reason.clone() };
                let _ = app.emit(STATUS_EVENT, Status::Down { reason });
            }
        }
    }

    fn spawn(&self, app: &AppHandle) -> Result<(), String> {
        let (program, args, cwd) = engine_command(app)?;

        let mut command = Command::new(&program);
        command
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(dir) = &cwd {
            command.current_dir(dir);
        }

        // Without this, a console window flashes up behind the app on every launch.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command
            .spawn()
            .map_err(|e| format!("could not start {}: {e}", program.display()))?;

        let stdout = child.stdout.take().ok_or("engine has no stdout")?;
        let stderr = child.stderr.take().ok_or("engine has no stderr")?;
        *self.stdin.lock().unwrap() = child.stdin.take();

        spawn_reader(app.clone(), stdout, self.pending.clone(), self.status.clone());
        spawn_logger(stderr);

        *self.child.lock().unwrap() = Some(child);
        Ok(())
    }

    /// Mint an id for a job the window is about to start.
    ///
    /// The window needs the id *before* the call, because that is what it cancels with
    /// — and a call that only reveals its id by returning is a job that cannot be
    /// stopped while it runs, which is the only time anyone wants to stop one.
    pub fn next_job_id(&self) -> String {
        format!("j{}", self.next_id.fetch_add(1, Ordering::Relaxed))
    }

    /// Send one request and wait for its terminal message.
    ///
    /// Progress does not come back through here — it arrives as an event while this is
    /// still awaiting, which is exactly the behaviour a progress bar needs.
    pub async fn call(&self, id: String, op: String, args: Value) -> Result<Value, String> {
        let (tx, rx) = oneshot::channel();

        {
            let mut pending = self.pending.lock().unwrap();
            if pending.contains_key(&id) {
                return Err(format!("job {id} is already running"));
            }
            pending.insert(id.clone(), tx);
        }

        if let Err(e) = self.write(&json!({ "id": &id, "op": op, "args": args })) {
            self.pending.lock().unwrap().remove(&id);
            return Err(e);
        }

        // An error here means the reader thread dropped the sender, which happens only
        // when the engine died mid-job. Reporting it as such beats hanging forever.
        rx.await.map_err(|_| "engine stopped before answering".to_string())
    }

    /// Ask a running job to stop. Fire and forget: the job's own terminal message is
    /// the answer, and cancelling something that already finished is a race, not a
    /// failure.
    pub fn cancel(&self, id: String) -> Result<(), String> {
        self.write(&json!({ "id": id, "op": "cancel" }))
    }

    fn write(&self, message: &Value) -> Result<(), String> {
        let mut guard = self.stdin.lock().unwrap();
        let stdin = guard.as_mut().ok_or("engine is not running")?;
        // One line, flushed. A request sitting in a buffer is indistinguishable from
        // an engine that hung.
        writeln!(stdin, "{message}").map_err(|e| format!("engine write failed: {e}"))?;
        stdin.flush().map_err(|e| format!("engine flush failed: {e}"))
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        // Closing stdin is the polite exit — the loop in main.py ends on EOF. The kill
        // is for the case where it is wedged, because a sidecar that outlives its
        // window is precisely the orphan that accumulates unnoticed.
        *self.stdin.lock().unwrap() = None;
        if let Some(child) = self.child.lock().unwrap().as_mut() {
            let _ = child.kill();
        }
    }
}

/// Where the engine lives, which differs between running from source and being
/// installed.
///
/// In development it is the checked-out Python, run by the project's own virtualenv if
/// one has been made — so an engine change is picked up by restarting the app, with no
/// packaging step in the loop. In a release build it is the PyInstaller bundle Tauri
/// ships beside the executable.
fn engine_command(app: &AppHandle) -> Result<(PathBuf, Vec<String>, Option<PathBuf>), String> {
    if cfg!(debug_assertions) {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("engine");
        let root = root.canonicalize().map_err(|e| format!("engine dir: {e}"))?;

        let venv = root.join(".venv").join("Scripts").join("python.exe");
        let python = if venv.exists() {
            venv
        } else {
            PathBuf::from("python")
        };

        return Ok((python, vec!["main.py".into()], Some(root)));
    }

    // Shipped under bundle.resources rather than as an externalBin, because the frozen
    // engine is a directory: an executable plus an `_internal` tree of native
    // libraries, and externalBin carries a single file. See desktop/engine/build.py.
    let dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource dir: {e}"))?
        .join("binaries");

    let exe = dir.join(if cfg!(windows) {
        "pdf2code-engine.exe"
    } else {
        "pdf2code-engine"
    });

    if !exe.exists() {
        return Err(format!("engine binary missing from the bundle ({})", exe.display()));
    }

    // Run it from its own directory so it finds `_internal` beside itself, whatever
    // the working directory of the app happens to be.
    Ok((exe, vec![], Some(dir)))
}

fn spawn_reader(
    app: AppHandle,
    stdout: std::process::ChildStdout,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    status: Arc<Mutex<Status>>,
) {
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                // The engine forces UTF-8 and owns stdout exclusively, so this should
                // not happen. If it does, one bad line must not desynchronise the rest.
                eprintln!("engine: unparseable line: {line}");
                continue;
            };

            match message.get("type").and_then(Value::as_str) {
                Some("ready") => {
                    let up = Status::Up {
                        protocol: message.get("protocol").and_then(Value::as_u64).unwrap_or(0)
                            as u32,
                        python: message
                            .get("python")
                            .and_then(Value::as_str)
                            .unwrap_or("?")
                            .to_string(),
                        ops: message
                            .get("ops")
                            .and_then(Value::as_array)
                            .map(|a| {
                                a.iter()
                                    .filter_map(Value::as_str)
                                    .map(str::to_string)
                                    .collect()
                            })
                            .unwrap_or_default(),
                    };
                    if let Status::Up { protocol, python, ops } = &up {
                        eprintln!(
                            "engine: up — protocol {protocol}, python {python}, ops [{}]",
                            ops.join(", ")
                        );
                    }
                    *status.lock().unwrap() = up.clone();
                    let _ = app.emit(STATUS_EVENT, up);
                }
                Some("progress") => {
                    let _ = app.emit(PROGRESS_EVENT, message);
                }
                // result and error both end a job, and both are what the caller
                // awaits — the front end decides which is bad news.
                _ => {
                    if let Some(id) = message.get("id").and_then(Value::as_str) {
                        if let Some(tx) = pending.lock().unwrap().remove(id) {
                            let _ = tx.send(message);
                        }
                    }
                }
            }
        }

        // The pipe closed: the engine is gone. Every caller still waiting is woken by
        // its sender being dropped here, rather than left awaiting forever.
        pending.lock().unwrap().clear();
        let down = Status::Down { reason: "engine stopped".into() };
        *status.lock().unwrap() = down.clone();
        let _ = app.emit(STATUS_EVENT, down);
    });
}

/// The engine's diagnostics. They can quote a document, so they go to our log and never
/// to the window.
fn spawn_logger(stderr: std::process::ChildStderr) {
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            eprintln!("engine: {line}");
        }
    });
}

// ---------------------------------------------------------------------------
// What the window is allowed to ask for. Three commands, no handles.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn engine_job_id(engine: State<'_, Engine>) -> String {
    engine.next_job_id()
}

#[tauri::command]
pub async fn engine_call(
    engine: State<'_, Engine>,
    id: String,
    op: String,
    args: Value,
) -> Result<Value, String> {
    engine.call(id, op, args).await
}

#[tauri::command]
pub fn engine_cancel(engine: State<'_, Engine>, id: String) -> Result<(), String> {
    engine.cancel(id)
}

#[tauri::command]
pub fn engine_status(engine: State<'_, Engine>) -> Status {
    engine.status()
}
