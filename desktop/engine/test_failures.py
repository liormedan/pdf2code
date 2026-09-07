"""Documents that will not open, and telling them apart.

    .venv/Scripts/python.exe test_failures.py

Two halves. The first calls `classify` directly on real files, because it is a pure
function and the interesting cases are cheap to build. The second sends the same files
through the **real sidecar**, because a classifier nobody reaches is not a fix.

The case worth stating: PDFium answers "Data format error" for a truncated file, a
renamed text file, a file another program has open, and one that is simply empty. Before
this, all four reached the window as `INTERNAL` carrying that sentence — a library's
words, identical for four different problems, none of them telling the person what to do.
"""

from __future__ import annotations

import json
import msvcrt
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from failures import classify

HERE = Path(__file__).parent
GOOD = HERE.parent.parent / "fixtures" / "08-hebrew-doc.pdf"

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}{f'  — {detail}' if detail else ''}")
    if not ok:
        FAILURES.append(name)


class Pdfium(Exception):
    """What pypdfium2 raises, in the words it uses. Copied, not imagined."""


FORMAT_ERROR = Pdfium("Failed to load document (PDFium: Data format error).")
PASSWORD_ERROR = Pdfium("Failed to load document (PDFium: Password required or incorrect password).")
SECURITY_ERROR = Pdfium("Failed to load document (PDFium: Unsupported security scheme).")


def check_classifier(work: Path) -> None:
    print("\n  Telling four identical exceptions apart")

    raw = GOOD.read_bytes()
    files = {
        "truncated.pdf": raw[: len(raw) // 3],
        "header-only.pdf": b"%PDF-1.7\n",
        "renamed.pdf": b"this is a text file somebody renamed\n" * 40,
        "empty.pdf": b"",
        "good.pdf": raw,
    }
    for name, data in files.items():
        (work / name).write_bytes(data)

    code, message = classify(FORMAT_ERROR, work / "truncated.pdf")
    check("a truncated PDF is damaged", (code, "damaged" in message) == ("UNREADABLE", True), message)

    code, message = classify(FORMAT_ERROR, work / "renamed.pdf")
    # The one that saves somebody hunting for corruption that was never there.
    check("a renamed text file is not a PDF", code == "UNREADABLE" and "not a PDF" in message, message)

    code, message = classify(FORMAT_ERROR, work / "empty.pdf")
    check("an empty file says so", code == "UNREADABLE" and "empty" in message, message)

    code, message = classify(FORMAT_ERROR, work / "missing.pdf")
    check("a file that is not there says so", code == "UNREADABLE" and "no such file" in message, message)

    code, message = classify(FORMAT_ERROR, work)
    check("a folder is not a document", code == "UNREADABLE" and "folder" in message, message)

    print("\n  Protection is a different answer from damage")

    code, message = classify(PASSWORD_ERROR, work / "good.pdf")
    check("a password-protected document is ENCRYPTED", code == "ENCRYPTED", f"{code}: {message}")

    code, message = classify(SECURITY_ERROR, work / "good.pdf")
    check("an unsupported scheme is ENCRYPTED too", code == "ENCRYPTED", f"{code}: {message}")

    print("\n  What must stay INTERNAL")

    # A bug in us must not be dressed up as somebody's bad file. This is the check that
    # keeps the classifier honest as it grows.
    code, message = classify(TypeError("unsupported operand type"), work / "good.pdf")
    check("an error that is not about the document stays INTERNAL", code == "INTERNAL", code)

    code, message = classify(TypeError("boom"), None)
    check("and so does one with no path to inspect", code == "INTERNAL", code)


def check_write_failures(work: Path) -> None:
    print("\n  The other half: the document opened and the output could not be written")

    # A full disk arrives as one of these numbers. Simulated by number rather than by
    # filling a real disk, because the code path is identical and the alternative is a
    # test that needs a spare volume to run.
    full = OSError("disk full")
    full.winerror = 112
    code, message = classify(full, GOOD, work / "out")
    check("a full disk says so", code == "UNWRITABLE" and "not enough room" in message, message)

    gone = OSError("path not found")
    gone.winerror = 3
    code, message = classify(gone, GOOD, work / "removed" / "out")
    check("a folder deleted mid-batch says so", code == "UNWRITABLE" and "does not exist" in message, message)

    denied = PermissionError("access denied")
    denied.winerror = 5
    code, message = classify(denied, GOOD, work / "out")
    check("a read-only destination says so", code == "UNWRITABLE" and "permission" in message, message)

    # The guard that keeps the two halves apart. A source another program holds open
    # raises PermissionError as well, and calling that a place we cannot write to would
    # send somebody to fix the wrong thing entirely.
    code, message = classify(PermissionError("access denied"), work / "locked-source.pdf", None)
    check(
        "a locked source is still a read problem, not a write one",
        code == "UNREADABLE",
        f"{code}: {message}",
    )


def check_over_the_wire(work: Path) -> None:
    print("\n  The same files, through the sidecar")

    proc = subprocess.Popen(
        [sys.executable, "main.py"],
        cwd=HERE,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        bufsize=1,
    )
    json.loads(proc.stdout.readline())

    def run(job: str, args: dict) -> dict:
        proc.stdin.write(json.dumps({"id": job, "op": "probe", "args": args}) + "\n")
        proc.stdin.flush()
        while True:
            message = json.loads(proc.stdout.readline())
            if message.get("id") == job and message.get("type") in ("result", "error"):
                return message

    # Writing somewhere impossible, over the wire, with a document that is perfectly fine.
    for label, out, expected in [
        ("a drive that is not there", "Z:/nowhere/out", "does not exist"),
        ("a file where the folder goes", str(work / "renamed.pdf"), "file where that folder"),
    ]:
        proc.stdin.write(
            json.dumps(
                {"id": label, "op": "convert", "args": {"path": str(GOOD), "out": out, "formats": ["html"]}}
            )
            + "\n"
        )
        proc.stdin.flush()
        while True:
            reply = json.loads(proc.stdout.readline())
            if reply.get("id") == label and reply.get("type") in ("result", "error"):
                break
        check(
            f"{label} is UNWRITABLE",
            reply.get("code") == "UNWRITABLE" and expected in reply.get("message", ""),
            f"{reply.get('code')}: {reply.get('message', '')[:46]}",
        )

    for name, expected in [
        ("truncated.pdf", "damaged"),
        ("renamed.pdf", "not a PDF"),
        ("empty.pdf", "empty"),
    ]:
        reply = run(name, {"path": str(work / name)})
        check(
            f"{name} comes back as UNREADABLE",
            reply.get("code") == "UNREADABLE" and expected in reply.get("message", ""),
            f"{reply.get('code')}: {reply.get('message', '')[:50]}",
        )
        # The whole point of the code being a code: no library internals reach the window.
        check(
            f"and {name} does not leak PDFium's own words",
            "PDFium" not in reply.get("message", ""),
            reply.get("message", "")[:50],
        )

    # A file another program holds open. PDFium reports this exactly as it reports
    # corruption, so only reading the file can tell them apart.
    locked = work / "locked.pdf"
    shutil.copy(GOOD, locked)
    handle = open(locked, "r+b")
    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
    try:
        reply = run("locked", {"path": str(locked)})
        check(
            "a locked file says another program has it",
            reply.get("code") == "UNREADABLE" and "another program" in reply.get("message", ""),
            reply.get("message", "")[:50],
        )
    finally:
        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        handle.close()

    # And the engine is still standing after all of it, which is the property that
    # matters more than any individual message.
    reply = run("still-alive", {"path": str(GOOD)})
    check("the engine still works afterwards", reply.get("pages") == 35, str(reply.get("pages")))

    proc.stdin.close()
    proc.wait(timeout=10)
    check("and exits cleanly", proc.returncode == 0, f"rc={proc.returncode}")


def main() -> int:
    if not GOOD.exists():
        print(f"missing fixture at {GOOD}")
        return 1

    print("documents that will not open")
    work = Path(tempfile.mkdtemp(prefix="pdf2code-failures-"))
    try:
        check_classifier(work)
        check_write_failures(work)
        check_over_the_wire(work)
    finally:
        shutil.rmtree(work, ignore_errors=True)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} failed: {', '.join(FAILURES[:4])}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
