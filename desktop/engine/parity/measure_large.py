"""What a large document actually costs, measured rather than assumed.

    .venv/Scripts/python.exe parity/measure_large.py [path-to-pdf]

Not a test suite — a measurement. It drives the **real sidecar** the way the window does
and reports time and peak memory for the operations a long document makes expensive:
converting it, rendering a thumbnail per page, and pulling text out of it.

Why it exists: every performance claim in this project so far came from a 150-page
fixture, and two of them turned out to be optimistic the moment a real document arrived.
Numbers that decide architecture should be re-measured at the size the architecture is
supposed to survive.

**Peak memory is the sidecar's, not ours.** The engine is a separate process, and the
question the roadmap asks is what *it* consumes — the window can only be as well behaved
as the process it is waiting on.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).parent.parent


def peak_mb(pid: int) -> float:
    """Peak working set of the sidecar **and its children**, in MB.

    The children matter, and getting this wrong is why the first version of this script
    reported 3.4 MB for a process converting five hundred pages. In a development build
    the engine is started through the virtualenv's `python.exe`, which on Windows is a
    launcher that spawns the real interpreter as a child — so measuring the process we
    spawned measured the launcher, and the 46 MB doing the actual work sat one level down
    where nothing was looking.

    A number an order of magnitude wrong is worse than no number: it is the one that ends
    up in a document.
    """
    script = (
        f"$ids = @({pid}); "
        f"$ids += (Get-CimInstance Win32_Process -Filter \"ParentProcessId={pid}\").ProcessId; "
        "($ids | ForEach-Object { (Get-Process -Id $_ -ErrorAction SilentlyContinue)"
        ".PeakWorkingSet64 } | Measure-Object -Sum).Sum"
    )
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command", script],
            capture_output=True,
            text=True,
            timeout=30,
        )
        return int(out.stdout.strip()) / 1024 / 1024
    except Exception:
        return 0.0


class Sidecar:
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
        json.loads(self.proc.stdout.readline())

    def run(self, job: str, op: str, args: dict) -> tuple[dict, int, float]:
        """Returns (reply, progress events, seconds)."""
        started = time.time()
        self.proc.stdin.write(json.dumps({"id": job, "op": op, "args": args}) + "\n")
        self.proc.stdin.flush()
        events = 0
        while True:
            message = json.loads(self.proc.stdout.readline())
            if message.get("id") != job:
                continue
            if message.get("type") == "progress":
                events += 1
                continue
            return message, events, time.time() - started

    def close(self) -> None:
        self.proc.stdin.close()
        self.proc.wait(timeout=10)


def main() -> int:
    document = Path(sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\liorm\AppData\Local\Temp\big-520p.pdf")
    if not document.exists():
        print(f"no document at {document}")
        return 1

    work = Path(tempfile.mkdtemp(prefix="pdf2code-measure-"))
    engine = Sidecar()
    pid = engine.proc.pid

    print(f"measuring {document.name} — {document.stat().st_size // 1024} KB")
    print(f"sidecar pid {pid}\n")

    reply, _, took = engine.run("p", "probe", {"path": str(document)})
    pages = reply.get("pages", 0)
    print(f"  probe          {took:6.2f}s   {pages} pages")

    reply, events, took = engine.run(
        "c", "convert", {"path": str(document), "out": str(work / "out"), "formats": ["html"]}
    )
    if reply.get("type") == "result":
        converted = reply["info"]["converted"]
        html = (work / "out" / "index.html")
        print(
            f"  convert        {took:6.2f}s   {converted} pages"
            f"   {took / max(1, converted) * 1000:5.0f} ms/page"
            f"   {events} progress events"
        )
        print(f"  index.html     {html.stat().st_size / 1024 / 1024:6.1f} MB")
    else:
        print(f"  convert        FAILED — {reply.get('message', '')[:70]}")

    reply, events, took = engine.run(
        "t", "thumbnails", {"path": str(document), "out": str(work / "th"), "width": 170}
    )
    thumbs = reply.get("thumbnails") or []
    if thumbs:
        sizes = [Path(t["path"]).stat().st_size for t in thumbs]
        print(
            f"  thumbnails     {took:6.2f}s   {len(thumbs)} images"
            f"   {took / max(1, len(thumbs)) * 1000:5.0f} ms/page"
        )
        print(
            f"  thumbnail size          total {sum(sizes) / 1024 / 1024:5.1f} MB"
            f"   largest {max(sizes) // 1024} KB"
            f"   as base64 {sum(sizes) * 4 / 3 / 1024 / 1024:5.1f} MB"
        )

    reply, _, took = engine.run("s", "text", {"path": str(document), "pages": list(range(1, 21))})
    print(f"  text (20 pages){took:6.2f}s")

    print(f"\n  sidecar peak memory {peak_mb(pid):6.1f} MB")

    engine.close()
    import shutil

    shutil.rmtree(work, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
