"""The wire, and the one rule that keeps it intact.

Newline-delimited JSON over stdin and stdout. No HTTP, no socket, no port — the
reasoning is in desktop/architecture.md §2 and it is a product decision, not a
stylistic one: our central customer buys this because nothing leaves the machine, and
a listening port is a finding in their security scan that somebody has to explain.

The rule: **stdout belongs to the protocol.** A single stray print() anywhere in this
process emits a line that is not JSON, and the Rust side either drops it or, worse,
resynchronises in the wrong place. `claim_stdout()` below takes the real handle away
and points `sys.stdout` at stderr, so the mistake becomes impossible rather than
merely forbidden.
"""

from __future__ import annotations

import json
import sys
import threading
from typing import Any, TextIO

# The version the `ready` line announces. The Rust side may refuse a sidecar it does
# not recognise, which is what makes a stale bundled binary a loud failure.
PROTOCOL_VERSION = 1

# ---------------------------------------------------------------------------
# Vocabulary carried over from src/converter/types.ts.
#
# Copied, not invented. The front end already knows how to display these, and
# messages/he.json and en.json already carry their translations — inventing a second
# vocabulary here would mean translating the same concepts twice and letting the two
# drift.
# ---------------------------------------------------------------------------

# ConversionProgress["phase"]
PHASES = ("extract", "render", "generate")

# WarningCode. NO_OFFSCREEN_CANVAS is deliberately absent: it described a browser
# limitation, and there is no browser here. Anything the engine cannot do now fails
# with an error code instead of a warning about a canvas.
WARNING_CODES = ("SCANNED", "GRAPHICS_DROPPED", "TRUNCATED")

# Error codes. CANCELLED is not a failure — it is the answer to a cancel, and the
# front end must not show it as one.
ERROR_CODES = (
    "CANCELLED",
    "BAD_REQUEST",
    "UNKNOWN_OP",
    "ENCRYPTED",
    "UNREADABLE",
    # The write side of UNREADABLE: the document opened fine and the output could not be
    # written. A full disk lands here, and so does a folder somebody deleted mid-batch.
    "UNWRITABLE",
    "INTERNAL",
)


class Wire:
    """The only thing allowed to write to the real stdout.

    Every write is one JSON object on one line, flushed immediately — a sidecar whose
    progress sits in a buffer until the job finishes has no progress at all. The lock
    matters because worker threads report progress concurrently, and two half-written
    lines interleaved are two unparseable lines.
    """

    def __init__(self, out: TextIO) -> None:
        self._out = out
        self._lock = threading.Lock()

    def send(self, message: dict[str, Any]) -> None:
        line = json.dumps(message, ensure_ascii=False, separators=(",", ":"))
        with self._lock:
            self._out.write(line + "\n")
            self._out.flush()

    # The three message kinds. Zero or more `progress`, then exactly one of the others.

    def progress(self, job_id: str, *, page: int, pages: int, phase: str) -> None:
        self.send(
            {"id": job_id, "type": "progress", "page": page, "pages": pages, "phase": phase}
        )

    def result(self, job_id: str, payload: dict[str, Any]) -> None:
        self.send({"id": job_id, "type": "result", **payload})

    def error(self, job_id: str, code: str, message: str) -> None:
        self.send({"id": job_id, "type": "error", "code": code, "message": message})

    def ready(self, ops: list[str]) -> None:
        """Announced once, before anything is read. Proves the process came up."""
        self.send(
            {
                "type": "ready",
                "protocol": PROTOCOL_VERSION,
                "python": sys.version.split()[0],
                "ops": ops,
            }
        )


def claim_stdout() -> TextIO:
    """Take the real stdout, and leave `print` pointed somewhere harmless.

    Returns the handle the Wire should own. After this call `sys.stdout is sys.stderr`,
    so a forgotten debug print lands in the log where it belongs instead of corrupting
    the stream. Deliberately called before any other import does work.

    All three streams are forced to UTF-8 first, and that is not housekeeping. A Python
    process launched on a Hebrew Windows install gets cp1255 on its pipes by default,
    which turns the first Hebrew character written — a filename, a document title, an
    error quoting either — into a byte the reader cannot decode. The contract test
    caught exactly this, and in a product whose whole point is Hebrew documents it
    would have been the first thing a real user hit.

    `newline="\\n"` matters for the same reason in the other direction: Windows would
    otherwise translate the framing newline to CRLF, and the stray carriage return
    rides along inside the line the Rust side is trying to parse.
    """
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        # Streams are always reconfigurable here in practice; guarded because a
        # redirected or wrapped stream in some host may not be.
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", newline="\n")

    real = sys.stdout
    sys.stdout = sys.stderr
    return real


def log(message: str) -> None:
    """Diagnostics go to stderr, always. The Rust side collects them for the log file."""
    print(message, file=sys.stderr, flush=True)
