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
use std::time::{Duration, Instant};

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

/// How long the engine may say **nothing at all** before a waiting job gives up on it.
///
/// Not a time limit on the work. Every operation that can run long reports progress per
/// page, so a document that takes ten minutes is heard from a hundred times on the way.
/// What this catches is the case that has no other symptom: the process is alive, its
/// stdout is still open — so the reader thread never notices — and it has simply stopped
/// answering. Without this, `call` awaits forever, the progress bar sits still, and
/// Cancel writes a line to a process that is not reading either.
///
/// Two minutes is deliberately generous. It is long enough that a single pathological
/// page cannot trip it, and short enough that nobody sits in front of a dead window
/// wondering whether to wait.
const SILENCE_LIMIT: Duration = Duration::from_secs(120);

/// How often a waiting job wakes to ask whether the engine has gone quiet.
const WATCHDOG_POLL: Duration = Duration::from_secs(5);

/// What `call` returns when the watchdog fires. Matched by the window, so it stays a
/// code with a stable prefix rather than a sentence — the same rule the engine's own
/// errors follow.
pub const HUNG: &str = "ENGINE_HUNG: the engine stopped answering";

/// Whether silence this long means the engine has stopped answering.
///
/// One line, pulled out because it is the whole judgement the watchdog makes and because
/// a decision that can only be exercised by waiting two minutes for a wedged subprocess
/// is a decision nobody exercises.
fn is_hung(silent_for: Duration, limit: Duration) -> bool {
    silent_for >= limit
}

/// Wait for a job to end, giving up if the engine goes silent for too long.
///
/// Takes `silence` as a closure rather than reading the engine directly, so the loop can
/// be tested against a receiver that never resolves and a clock that does whatever the
/// test needs. Waiting two real minutes on a real wedged subprocess to find out whether
/// this works is not a test anybody runs twice.
async fn await_with_watchdog(
    rx: oneshot::Receiver<Value>,
    silence: impl Fn() -> Duration,
    limit: Duration,
    poll: Duration,
) -> Result<Value, String> {
    let mut rx = rx;
    loop {
        match tokio::time::timeout(poll, &mut rx).await {
            // The job ended, one way or the other. `result` and `error` both arrive
            // here; deciding which is bad news is the caller's job.
            Ok(Ok(message)) => return Ok(message),
            // The sender was dropped, which happens when the engine died mid-job or the
            // engine was restarted underneath it. Reporting it beats hanging forever.
            Ok(Err(_)) => return Err("engine stopped before answering".into()),
            // Still waiting, which is normal. The question is only whether the engine has
            // gone quiet altogether — a job reporting progress resets that clock however
            // long it runs.
            Err(_) if is_hung(silence(), limit) => return Err(HUNG.into()),
            Err(_) => continue,
        }
    }
}

pub struct Engine {
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    status: Arc<Mutex<Status>>,
    next_id: AtomicU64,
    log: Arc<crate::report::Log>,
    /// When the engine last proved it was alive — either by writing a line or by being
    /// asked something. Written by the reader thread, read by every waiting job.
    last_heard: Arc<Mutex<Instant>>,
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
            log: Arc::new(crate::report::Log::default()),
            last_heard: Arc::new(Mutex::new(Instant::now())),
        }
    }

    /// The engine's recent diagnostics, for a trouble report. Scrubbed by report.rs.
    pub fn log(&self) -> Arc<crate::report::Log> {
        self.log.clone()
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

        // Reset before the reader starts: the clock measures silence since we last had
        // reason to believe the engine was alive, and a fresh process is that reason.
        *self.last_heard.lock().unwrap() = Instant::now();

        spawn_reader(
            app.clone(),
            stdout,
            self.pending.clone(),
            self.status.clone(),
            self.last_heard.clone(),
        );
        spawn_logger(stderr, self.log.clone());

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

        // Asking counts as hearing: the clock measures how long the engine has been quiet
        // since it had something to answer. Without this reset, a job submitted after an
        // idle afternoon would be declared hung the moment it started.
        *self.last_heard.lock().unwrap() = Instant::now();

        let last_heard = self.last_heard.clone();
        let outcome = await_with_watchdog(
            rx,
            move || last_heard.lock().unwrap().elapsed(),
            SILENCE_LIMIT,
            WATCHDOG_POLL,
        )
        .await;

        // A job the watchdog gave up on is still registered, and nothing is ever going to
        // answer it. Left in place it would make a later job with the same id impossible.
        if outcome.as_ref().err().map(String::as_str) == Some(HUNG) {
            self.pending.lock().unwrap().remove(&id);
        }
        outcome
    }

    /// Kill the engine and start it again.
    ///
    /// The kill comes first and the polite stdin close does not: a wedged process is
    /// wedged precisely because it is not reading its stdin, so closing it would change
    /// nothing and leave the old process alive beside the new one.
    ///
    /// Every job still waiting is woken by its sender being dropped with `pending`, so a
    /// restart never leaves a caller awaiting a process that no longer exists.
    pub fn restart(&self, app: &AppHandle) {
        {
            if let Some(child) = self.child.lock().unwrap().as_mut() {
                let _ = child.kill();
                // Reaped here rather than left to the OS: an unwaited child on Windows
                // keeps its handle, and this is a path that can run repeatedly.
                let _ = child.wait();
            }
        }
        *self.child.lock().unwrap() = None;
        *self.stdin.lock().unwrap() = None;
        self.pending.lock().unwrap().clear();

        eprintln!("engine: restarting");
        self.start(app);
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
    last_heard: Arc<Mutex<Instant>>,
) {
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };

            // Any line at all, including one we cannot parse: this is a liveness signal,
            // not a correctness one.
            *last_heard.lock().unwrap() = Instant::now();

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
        //
        // Logged, because it was not: the log said the engine had been spawned and that
        // it had come up, and then went quiet about the one transition somebody reading
        // the log is trying to explain.
        eprintln!("engine: stopped — its stdout closed");
        pending.lock().unwrap().clear();
        let down = Status::Down { reason: "engine stopped".into() };
        *status.lock().unwrap() = down.clone();
        let _ = app.emit(STATUS_EVENT, down);
    });
}

/// The engine's diagnostics. They can quote a document, so they go to our log and never
/// to the window.
fn spawn_logger(stderr: std::process::ChildStderr, log: Arc<crate::report::Log>) {
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            eprintln!("engine: {line}");
            // Kept as well as printed. In a release build there is no console to print
            // to, and these lines are the only account of what went wrong on a machine
            // we cannot see. They are scrubbed of paths before they go anywhere — see
            // report.rs, which is the other half of the decision to keep them out of the
            // window in the first place.
            log.push(line);
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

/// Run one job.
///
/// The one check here is about **writing**. Five of the nine operations take an `out`,
/// and this command forwards whatever the window put in `args` — so a front end that
/// could name any `out` would have a write primitive at an arbitrary path, through an
/// engine that creates directories on the way. A path is writable only if a native
/// dialog produced it or this side made it; see workbench::Writable.
/// Whether a request may write where it says it will. Both places an operation writes
/// are checked: its output, and the scratch it stages in.
///
/// Protection is checked first and answered with a code of its own, because writing over
/// the original is a different mistake from writing somewhere unchosen — and the window
/// has to word them differently. One operation may cross it: `edit` saving over a source,
/// which the window only sends with `overwrite` after asking and being told yes.
/// `compress` never may, whatever its arguments say, and the engine refuses it a second
/// time on its own — so an `invoke` that adds `overwrite` to a compress gets past nothing.
pub fn gate(writable: &crate::workbench::Writable, op: &str, args: &Value) -> Result<(), String> {
    let may_overwrite =
        op == "edit" && args.get("overwrite").and_then(Value::as_bool) == Some(true);
    for key in ["out", "scratch"] {
        if let Some(target) = args.get(key).and_then(Value::as_str) {
            let target = std::path::Path::new(target);
            if writable.protects(target) && !may_overwrite {
                return Err("SOURCE_OVERWRITE: that is one of the documents".into());
            }
            if !writable.chosen(target) {
                return Err("refused: nobody chose that place to write to".into());
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn engine_call(
    app: AppHandle,
    engine: State<'_, Engine>,
    writable: State<'_, crate::workbench::Writable>,
    id: String,
    op: String,
    args: Value,
) -> Result<Value, String> {
    gate(&writable, &op, &args)?;

    let outcome = engine.call(id, op, args).await;

    // A wedged engine does not un-wedge. Leaving it running means the next job waits two
    // minutes to fail the same way, and the one after that — so the recovery happens here
    // rather than being left as advice in an error message.
    if outcome.as_ref().err().map(String::as_str) == Some(HUNG) {
        engine.restart(&app);
    }
    outcome
}

#[tauri::command]
pub fn engine_cancel(engine: State<'_, Engine>, id: String) -> Result<(), String> {
    engine.cancel(id)
}

#[tauri::command]
pub fn engine_status(engine: State<'_, Engine>) -> Status {
    engine.status()
}

/// Start the engine over, on request.
///
/// The window offers this wherever it reports the engine as down, because the honest
/// alternative it used to offer was "close the app and open it again" — which works, and
/// is a strange thing to ask of somebody sitting in front of a button that could do it.
#[tauri::command]
pub fn engine_restart(app: AppHandle, engine: State<'_, Engine>) -> Status {
    engine.restart(&app);
    engine.status()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_gate_keeps_the_footers_promise_for_every_operation() {
        // The sequence the save dialog makes possible: a document is open, and the
        // person picks that very file as where to write. The dialog blesses it; the gate
        // must still say no — except for the one operation that asks first.
        let writable = crate::workbench::Writable::default();
        let root = std::env::temp_dir().join("pdf2code-gate-test");
        std::fs::create_dir_all(&root).unwrap();
        let source = root.join("source.pdf");
        std::fs::write(&source, b"%PDF-1.4\n").unwrap();
        let scratch = root.join("scratch");
        std::fs::create_dir_all(&scratch).unwrap();
        writable.protect(&source);
        writable.allow(&source);
        writable.allow(&scratch);
        let s = source.to_string_lossy().into_owned();
        let sc = scratch.to_string_lossy().into_owned();
        let code = |r: Result<(), String>| r.err().map(|e| e.split(':').next().unwrap().to_string());

        // Compress over a source: refused, and `overwrite` changes nothing.
        let compress = json!({ "plan": [], "out": s, "scratch": sc });
        assert_eq!(code(gate(&writable, "compress", &compress)), Some("SOURCE_OVERWRITE".into()));
        let forced = json!({ "plan": [], "out": s, "scratch": sc, "overwrite": true });
        assert_eq!(code(gate(&writable, "compress", &forced)), Some("SOURCE_OVERWRITE".into()));

        // Saving over a source: refused until the window says it asked.
        let save = json!({ "plan": [], "out": s });
        assert_eq!(code(gate(&writable, "edit", &save)), Some("SOURCE_OVERWRITE".into()));
        let confirmed = json!({ "plan": [], "out": s, "overwrite": true });
        assert_eq!(gate(&writable, "edit", &confirmed), Ok(()));

        // Nothing unchosen, as before.
        let elsewhere = json!({ "out": root.join("unchosen.pdf").to_string_lossy() });
        assert_eq!(code(gate(&writable, "edit", &elsewhere)), Some("refused".into()));

        // Scratch is gated like out: staging inside a document is writing over it, even
        // when the output itself is somewhere perfectly fine.
        writable.allow(&root);
        let staged_in_source = json!({ "plan": [], "out": root.join("x.pdf").to_string_lossy(), "scratch": s });
        assert_eq!(code(gate(&writable, "compress", &staged_in_source)), Some("SOURCE_OVERWRITE".into()));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn silence_under_the_limit_is_just_a_slow_job() {
        assert!(!is_hung(Duration::from_secs(0), SILENCE_LIMIT));
        assert!(!is_hung(Duration::from_secs(119), SILENCE_LIMIT));
    }

    #[test]
    fn silence_at_the_limit_is_a_hung_engine() {
        assert!(is_hung(SILENCE_LIMIT, SILENCE_LIMIT));
        assert!(is_hung(Duration::from_secs(600), SILENCE_LIMIT));
    }

    #[test]
    fn the_watchdog_wakes_far_more_often_than_it_fires() {
        // If these ever crossed, a job could sit past the limit without anything
        // checking — the watchdog would exist and not watch.
        assert!(
            WATCHDOG_POLL < SILENCE_LIMIT,
            "the poll interval has to be shorter than the limit it enforces"
        );
    }

    /// Silence long past the limit, and a job that never answers: the loop has to give
    /// up rather than await forever. This is the failure the watchdog exists for, and
    /// before it the window sat on a still progress bar with a Cancel that went nowhere.
    #[tokio::test]
    async fn a_job_that_never_answers_a_silent_engine_gives_up() {
        let (_tx, rx) = oneshot::channel::<Value>();
        let outcome = await_with_watchdog(
            rx,
            || Duration::from_secs(999),
            Duration::from_millis(10),
            Duration::from_millis(1),
        )
        .await;
        assert_eq!(outcome.err().as_deref(), Some(HUNG));
    }

    /// The case that must **not** fire: a long job on a talkative engine. The clock keeps
    /// being reset by progress, so however long this waits, it waits.
    #[tokio::test]
    async fn a_long_job_on_a_talking_engine_is_left_alone() {
        let (tx, rx) = oneshot::channel::<Value>();

        // Answers only after several watchdog polls have already come and gone.
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(30)).await;
            let _ = tx.send(json!({ "type": "result", "ok": true }));
        });

        let outcome = await_with_watchdog(
            rx,
            // Never silent: this is what progress arriving looks like to the watchdog.
            || Duration::from_millis(0),
            Duration::from_millis(10),
            Duration::from_millis(1),
        )
        .await;

        assert_eq!(
            outcome.expect("a talking engine must never be declared hung")["ok"],
            json!(true)
        );
    }

    /// An engine that dies mid-job wakes its callers rather than leaving them waiting,
    /// and is reported as a death rather than as a hang — they are different states and
    /// the window says different things about them.
    #[tokio::test]
    async fn an_engine_that_dies_is_not_reported_as_hung() {
        let (tx, rx) = oneshot::channel::<Value>();
        drop(tx);

        let outcome = await_with_watchdog(
            rx,
            || Duration::from_millis(0),
            Duration::from_millis(10),
            Duration::from_millis(1),
        )
        .await;

        assert_eq!(outcome.err().as_deref(), Some("engine stopped before answering"));
    }

    #[test]
    fn the_hung_code_is_matchable_by_the_window() {
        // The front end distinguishes this from a cancel and from a crash by prefix, the
        // same way it already reads the engine's own error codes.
        assert!(HUNG.starts_with("ENGINE_HUNG"));
    }
}
