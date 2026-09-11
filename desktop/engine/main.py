"""The sidecar's loop.

Read lines from stdin, run each request on a worker thread, write results back. The
whole design turns on one requirement: **a cancel has to arrive while the job it
cancels is still running.** That rules out the obvious single-threaded loop, where the
next read only happens after the current job finishes and cancellation becomes a
theory. So the main thread does nothing but read and dispatch, and the work happens
elsewhere.

There is a QA check in the web app named "cancellation is prompt" that fails if more
than a handful of pages are processed after an abort. It is the same requirement, and
this is the structure that satisfies it.
"""

from __future__ import annotations

import json
import sys
import threading
from typing import Any

from failures import classify
from ops import OPS, Cancelled
from protocol import Refusal, Wire, claim_stdout, log

# Taken before anything else can print. See protocol.claim_stdout.
WIRE = Wire(claim_stdout())


class Job:
    """One request in flight, and the flag that stops it."""

    def __init__(self, job_id: str) -> None:
        self.id = job_id
        self._stop = threading.Event()

    def cancel(self) -> None:
        self._stop.set()

    # --- the Context an operation is handed -------------------------------------

    @property
    def cancelled(self) -> bool:
        return self._stop.is_set()

    def checkpoint(self) -> None:
        if self._stop.is_set():
            raise Cancelled()

    def progress(self, *, page: int, pages: int, phase: str) -> None:
        # Progress from a cancelled job is noise the front end has already stopped
        # caring about, and it can arrive after the error line, which looks like the
        # job came back to life.
        if not self._stop.is_set():
            WIRE.progress(self.id, page=page, pages=pages, phase=phase)


class Registry:
    """The jobs currently running, so a cancel can find its target."""

    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def add(self, job: Job) -> None:
        with self._lock:
            self._jobs[job.id] = job

    def remove(self, job_id: str) -> None:
        with self._lock:
            self._jobs.pop(job_id, None)

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            return False
        job.cancel()
        return True


JOBS = Registry()


def run_job(job: Job, op_name: str, args: dict[str, Any]) -> None:
    """Run one operation and emit exactly one terminal message."""
    try:
        handler = OPS[op_name]
        payload = handler(args, job)
        # A job that was cancelled mid-flight may still reach here if the operation
        # finished before it noticed. The cancel is what the caller is waiting to
        # hear about, so it wins.
        if job.cancelled:
            WIRE.error(job.id, "CANCELLED", "cancelled")
        else:
            WIRE.result(job.id, payload)
    except Cancelled:
        WIRE.error(job.id, "CANCELLED", "cancelled")
    except Refusal as exc:
        # A "no" with its own code, so the window can say why in the reader's language.
        log(f"job {job.id} refused ({exc.code}): {exc.message}")
        WIRE.error(job.id, exc.code, exc.message)
    except ValueError as exc:
        # An operation refusing its arguments — an empty plan, a page that does not
        # exist, an output that is also an input. Those are answers rather than
        # incidents, and each already carries the sentence the operation wrote for it.
        log(f"job {job.id} refused: {exc}")
        WIRE.error(job.id, "BAD_REQUEST", str(exc))
    except Exception as exc:  # noqa: BLE001 — a sidecar must not die of one bad job
        # The traceback goes to the log, not to the window: it can quote a document's
        # contents, and this product's whole claim is that those stay put.
        log(f"job {job.id} failed: {exc!r}")
        # Every document that failed to open used to arrive as INTERNAL carrying
        # PDFium's own words — the same sentence for a truncated file, an empty one, a
        # renamed text file, and one another program had open. `classify` tells them
        # apart by looking at the file, because the exception cannot.
        fields = args if isinstance(args, dict) else {}
        code, message = classify(exc, fields.get("path"), fields.get("out"))
        WIRE.error(job.id, code, message)
    finally:
        JOBS.remove(job.id)


def handle(message: dict[str, Any]) -> None:
    """Dispatch one parsed request. Never raises."""
    job_id = message.get("id")
    op_name = message.get("op")

    if not isinstance(job_id, str) or not job_id:
        log(f"dropping message with no id: {message!r}")
        return

    if op_name == "cancel":
        # `id` names the job being cancelled, not a message of its own. A cancel
        # gets no reply — the cancelled job's own error line is the answer, and a
        # cancel for a job that already finished is a race, not an error.
        JOBS.cancel(job_id)
        return

    if not isinstance(op_name, str) or op_name not in OPS:
        WIRE.error(job_id, "UNKNOWN_OP", f"unknown op: {op_name!r}")
        return

    args = message.get("args")
    if args is None:
        args = {}
    if not isinstance(args, dict):
        WIRE.error(job_id, "BAD_REQUEST", "args must be an object")
        return

    job = Job(job_id)
    JOBS.add(job)
    # Daemon threads: when the parent goes away, stdin closes, this loop ends, and the
    # process should follow rather than linger holding a half-finished job.
    threading.Thread(
        target=run_job, args=(job, op_name, args), name=f"job-{job_id}", daemon=True
    ).start()


def main() -> int:
    WIRE.ready(sorted(OPS))

    # Reading line by line off the raw stream rather than iterating the file object:
    # iteration adds its own buffering, which on Windows can hold a line back until
    # the buffer fills — and a request that arrives late is indistinguishable from a
    # sidecar that hung.
    while True:
        line = sys.stdin.readline()
        if line == "":
            # EOF: the parent closed the pipe or died. Leaving is correct — an
            # orphaned sidecar with no one to answer is exactly the kind of process
            # that accumulates unnoticed.
            break

        line = line.strip()
        if not line:
            continue

        try:
            message = json.loads(line)
        except json.JSONDecodeError as exc:
            log(f"unparseable line: {exc}")
            continue

        if not isinstance(message, dict):
            log("dropping non-object message")
            continue

        handle(message)

    return 0


if __name__ == "__main__":
    sys.exit(main())
