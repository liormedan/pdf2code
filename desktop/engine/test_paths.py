"""Hebrew file names, spaces, and the other paths that break a pipe.

    .venv/Scripts/python.exe test_paths.py

The engine forces UTF-8 on all three streams the moment it starts, and the reason given
at the time was that otherwise a Hebrew file name breaks the channel. That reason was
never tested end to end: every fixture this project has is named in ASCII with no spaces,
because we named them.

So this suite drives the **real sidecar** with paths a person would actually produce and
we never would: a Hebrew document name, a folder with spaces in it, a name carrying the
punctuation Hebrew typing puts there, and a path long enough to be interesting. It sends
them as JSON over the pipe, exactly as the window does.

**Every check here is about the path, not about the conversion.** The conversion is
covered elsewhere; what is being asked is whether a name survives being encoded into
JSON, written to a pipe, decoded by Python, handed to PDFium and pdfminer, and returned.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).parent
FIXTURE = HERE.parent.parent / "fixtures" / "08-hebrew-doc.pdf"

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}{f'  — {detail}' if detail else ''}")
    if not ok:
        FAILURES.append(name)


class Sidecar:
    """The engine as the Rust side drives it: one process, two pipes."""

    def __init__(self) -> None:
        self.proc = subprocess.Popen(
            [sys.executable, "main.py"],
            cwd=HERE,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        json.loads(self.proc.stdout.readline())  # ready

    def run(self, job: str, op: str, args: dict) -> dict:
        self.proc.stdin.write(json.dumps({"id": job, "op": op, "args": args}) + "\n")
        self.proc.stdin.flush()
        while True:
            message = json.loads(self.proc.stdout.readline())
            if message.get("id") == job and message.get("type") in ("result", "error"):
                return message

    def close(self) -> None:
        self.proc.stdin.close()
        self.proc.wait(timeout=5)


#: Names we would never have chosen, which is the point. Each one is a real shape:
#: a Hebrew document name; a name with the punctuation a Hebrew keyboard produces; a
#: name mixing scripts, which is what a version-stamped Hebrew report looks like.
NAMES = [
    "מסמך עברי.pdf",
    "דוח רבעוני (טיוטה).pdf",
    "מפרט טכני v2 — סופי.pdf",
    "Hebrew מעורב Mixed 2026.pdf",
]

#: Folders that are ordinary on a Windows desktop and absent from this repository.
FOLDERS = [
    "תיקייה בעברית",
    "My Documents",
    "שם עם רווחים ארוך במיוחד",
]


def main() -> int:
    if not FIXTURE.exists():
        print(f"missing fixture at {FIXTURE}")
        return 1

    print("paths a person makes and we never did")
    work = Path(tempfile.mkdtemp(prefix="pdf2code paths "))  # a space in the root, too
    engine = Sidecar()

    try:
        for folder in FOLDERS:
            for name in NAMES:
                directory = work / folder
                directory.mkdir(parents=True, exist_ok=True)
                document = directory / name
                shutil.copy(FIXTURE, document)

                label = f"{folder}/{name}"
                reply = engine.run("p", "probe", {"path": str(document)})
                check(
                    f"probe opens {label}",
                    reply.get("type") == "result" and reply.get("pages") == 35,
                    str(reply.get("message", reply.get("pages")))[:60],
                )
                # The name went out as JSON and came back through PDFium; if any stage
                # had re-encoded it, the file simply would not have been found.
                check(
                    f"and reads its Hebrew from {label}",
                    (reply.get("rtl") or 0) > 0,
                    f"{reply.get('rtl')} rtl chars",
                )

        print("\n  A conversion whose output folder is also awkward")

        source = work / "תיקייה בעברית" / "מסמך עברי.pdf"
        out = work / "פלט עם רווחים" / "המרה 1"
        reply = engine.run("c", "convert", {"path": str(source), "out": str(out), "formats": ["html"]})
        check("convert writes into a Hebrew folder with spaces", reply.get("type") == "result",
              str(reply.get("message", ""))[:70])
        check("the path it returns is the path we asked for", reply.get("out") == str(out))

        written = out / "index.html"
        check("the file is really there", written.exists())
        if written.exists():
            page = written.read_text(encoding="utf-8")
            # The point of the whole exercise: an awkward path must not cost the content.
            check("and the Hebrew inside survived the round trip", 'dir="rtl"' in page)

        print("\n  Packing and page work over the same paths")

        archive = work / "פלט עם רווחים" / "ארכיון סופי.zip"
        reply = engine.run("z", "zip", {"path": str(out), "out": str(archive), "overwrite": True})
        check("zip writes to a Hebrew archive name", reply.get("type") == "result",
              str(reply.get("message", ""))[:70])
        check("and the archive exists", archive.exists())

        edited = work / "תיקייה בעברית" / "מסמך ערוך.pdf"
        reply = engine.run(
            "e",
            "edit",
            {"plan": [{"from": str(source), "page": 1, "rotate": 90}], "out": str(edited)},
        )
        check("edit saves under a Hebrew name", reply.get("type") == "result",
              str(reply.get("message", ""))[:70])
        check("and that document exists", edited.exists())

        print("\n  What must still be refused, awkward path or not")

        # The refusals are the reason a path test is not just a happy-path test: a Hebrew
        # name must not become a way around a rule that holds for ASCII ones.
        reply = engine.run(
            "r",
            "edit",
            {"plan": [{"from": str(source), "page": 1}], "out": str(source)},
        )
        check(
            "writing over a Hebrew-named source is still refused",
            reply.get("type") == "error" and "overwrite" in reply.get("message", "").lower(),
            reply.get("message", "")[:60],
        )

        reply = engine.run("m", "probe", {"path": str(work / "תיקייה בעברית" / "אין כזה.pdf")})
        check("a missing Hebrew path fails as an error, not a crash", reply.get("type") == "error")

        engine.close()
        check("the engine is still alive after all of it", engine.proc.returncode == 0,
              f"rc={engine.proc.returncode}")
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
