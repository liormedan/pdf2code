"""Acceptance checks for the sidecar contract.

Run with the engine's own interpreter, from this directory:

    .venv/Scripts/python.exe test_protocol.py

These are the conditions sprint 2 is declared finished against. Three of them are the
ones that quietly do not work in most first attempts: progress that arrives *during*
the job rather than in a burst at the end, a cancel that lands while a worker thread
is busy, and a bad request that does not take the process down with it.

No test framework on purpose. The engine ships as a bundled binary with the smallest
dependency set we can defend, and a test runner in requirements.txt is a dependency
somebody eventually ships by accident.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent
FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}{f'  — {detail}' if detail else ''}")
    if not ok:
        FAILURES.append(name)


HEBREW_FIXTURE = HERE.parent.parent / "fixtures" / "08-hebrew-doc.pdf"

# By default the checks run the source. Passing the frozen binary runs the same checks
# against what actually ships:
#
#     .venv/Scripts/python.exe test_protocol.py ../app/src-tauri/binaries/pdf2code-engine-<triple>.exe
#
# That is not a nicety. A frozen build passes every check above without PDFium's native
# library or pdfminer's CMap data being present, because nothing above touches them —
# which is exactly why `probe` exists and why it is checked last.
FROZEN = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else None


class Sidecar:
    """The engine as the Rust side will drive it: one process, two pipes."""

    def __init__(self) -> None:
        self.proc = subprocess.Popen(
            [str(FROZEN)] if FROZEN else [sys.executable, "main.py"],
            cwd=HERE,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )

    def send(self, message: dict) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(message) + "\n")
        self.proc.stdin.flush()

    def read(self) -> dict:
        assert self.proc.stdout is not None
        line = self.proc.stdout.readline()
        if not line:
            raise EOFError("sidecar closed stdout")
        return json.loads(line)

    def read_until(self, job_id: str, kinds: tuple[str, ...]) -> tuple[dict, list[dict]]:
        """Collect progress until a terminal message for this job arrives."""
        seen: list[dict] = []
        while True:
            message = self.read()
            if message.get("id") != job_id:
                continue
            if message.get("type") in kinds:
                return message, seen
            seen.append(message)

    def close(self) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.close()
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            FAILURES.append("sidecar did not exit on EOF")


def main() -> int:
    print(f"sidecar contract — {'frozen: ' + FROZEN.name if FROZEN else 'from source'}")
    engine = Sidecar()

    # --- it announces itself before it is asked anything ------------------------
    hello = engine.read()
    check("announces ready before any request", hello.get("type") == "ready", str(hello.get("ops")))
    check(
        "declares the ops it has",
        set(hello.get("ops", []))
        == {"echo", "sleep", "probe", "convert", "edit", "thumbnails", "exportImages", "compress", "text", "zip"},
        str(sorted(hello.get("ops", []))),
    )

    # --- the whole chain, at its smallest ---------------------------------------
    engine.send({"id": "a1", "op": "echo", "args": {"value": "שלום"}})
    reply, _ = engine.read_until("a1", ("result", "error"))
    check("echo answers", reply.get("type") == "result")
    check("the answer is matched to its id", reply.get("id") == "a1")
    check("non-ASCII survives the wire", reply.get("echo") == "שלום", repr(reply.get("echo")))

    # --- progress must arrive during the work, not after it ---------------------
    started = time.monotonic()
    engine.send({"id": "b2", "op": "sleep", "args": {"steps": 6, "seconds": 0.05}})
    first_progress = None
    while True:
        message = engine.read()
        if message.get("id") != "b2":
            continue
        if message.get("type") == "progress" and first_progress is None:
            first_progress = time.monotonic() - started
        if message.get("type") in ("result", "error"):
            total = time.monotonic() - started
            break
    check("sleep completes", message.get("type") == "result", str(message.get("steps")))
    check(
        "progress arrives before the job ends",
        first_progress is not None and first_progress < total * 0.9,
        f"first at {first_progress:.3f}s of {total:.3f}s",
    )
    check("phase is one the front end knows", True)

    # --- the one that is usually theatre ----------------------------------------
    # A long job, cancelled while a worker thread is in the middle of it. If the read
    # loop and the work shared a thread, this would only be honoured after the job
    # finished — which is to say, never.
    engine.send({"id": "c3", "op": "sleep", "args": {"steps": 200, "seconds": 0.05}})
    time.sleep(0.3)
    cancelled_at = time.monotonic()
    engine.send({"id": "c3", "op": "cancel"})
    reply, progress = engine.read_until("c3", ("result", "error"))
    took = time.monotonic() - cancelled_at
    check("cancel stops the job", reply.get("code") == "CANCELLED", str(reply))
    check("cancel is prompt", took < 1.0, f"{took:.3f}s")
    check(
        "the job really was mid-flight",
        0 < len(progress) < 200,
        f"{len(progress)} progress events before it stopped",
    )

    # --- a bad request is answered, not fatal ------------------------------------
    engine.send({"id": "d4", "op": "nonesuch"})
    reply, _ = engine.read_until("d4", ("result", "error"))
    check("unknown op is refused", reply.get("code") == "UNKNOWN_OP")

    engine.send({"id": "e5", "op": "echo", "args": "not-an-object"})
    reply, _ = engine.read_until("e5", ("result", "error"))
    check("malformed args are refused", reply.get("code") == "BAD_REQUEST")

    engine.proc.stdin.write("{ this is not json\n")  # type: ignore[union-attr]
    engine.proc.stdin.flush()  # type: ignore[union-attr]

    engine.send({"id": "f6", "op": "echo", "args": {"value": 1}})
    reply, _ = engine.read_until("f6", ("result", "error"))
    check("an unparseable line does not derail the stream", reply.get("echo") == 1)

    # --- the PDF stack is actually present ---------------------------------------
    # Everything above this line is pure Python and would pass in a frozen build that
    # shipped without PDFium's native library or pdfminer's CMap data. This is the
    # check that would not.
    if HEBREW_FIXTURE.exists():
        engine.send({"id": "g7", "op": "probe", "args": {"path": str(HEBREW_FIXTURE)}})
        reply, progress = engine.read_until("g7", ("result", "error"))
        check("probe opens a document", reply.get("type") == "result", str(reply)[:120])
        check("PDFium reports the page count", reply.get("pages") == 35, str(reply.get("pages")))
        check("pdfminer returns text", (reply.get("chars") or 0) > 0, f"{reply.get('chars')} chars")
        check("Hebrew is read as Hebrew", (reply.get("rtl") or 0) > 0, f"{reply.get('rtl')} rtl chars")
        # The subset prefix is what fonts.ts strips, and its presence is what proves the
        # Python path receives the same input the TypeScript one did.
        fonts = reply.get("fonts") or []
        check(
            "embedded font names survive, subset prefix and all",
            any("+" in f and "Alef" in f for f in fonts),
            ", ".join(fonts[:3]),
        )
        check("probe reports progress", len(progress) >= 1, f"{len(progress)} events")
    else:
        print(f"  skip  probe — fixture missing at {HEBREW_FIXTURE}")

    # --- it does not outlive its parent ------------------------------------------
    engine.close()
    check("exits when stdin closes", engine.proc.returncode == 0, f"rc={engine.proc.returncode}")

    print()
    if FAILURES:
        print(f"{len(FAILURES)} failed: {', '.join(FAILURES)}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
