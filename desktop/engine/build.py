"""Freeze the engine into the binary Tauri ships beside the app.

    .venv/Scripts/python.exe build.py

Why this is a script and not a one-line command in a README: three of the flags below
are load-bearing, and each of them fails in a way that only shows up in the installed
app rather than in development.

**--onedir, not --onefile.** A onefile build unpacks itself into a temp directory on
every launch. That costs a second of startup, and — more importantly on the machines
our customers use — it makes an executable that writes and executes a fresh copy of
itself on every run, which is what aggressive antivirus is built to notice.

**--collect-all pypdfium2.** PDFium is a native library. PyInstaller's module scanner
follows imports, and a `.dll` referenced at runtime by a binding is not an import — so
without this the frozen engine starts, answers `ready`, and then fails on the first
document with a missing library.

**--collect-all pdfminer.** It ships CMap data as package files. Missing them does not
crash: it silently mangles text in exactly the documents we care about most, the ones
with non-Latin encodings.

**Shipped as a resource, not as `externalBin`.** That was the first choice and it does
not work here: `externalBin` carries a single file, and a `--onedir` build is an
executable plus an `_internal` tree of native libraries. Declaring the whole directory
under `bundle.resources` ships all of it and keeps the layout, which is what the Rust
side then resolves against `resource_dir()`.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent

# One fact, stored once. The Rust side resolves this same name under resource_dir(),
# and tauri.conf.json ships the directory it lands in.
NAME = "pdf2code-engine"

SIDECAR_DIR = HERE.parent / "app" / "src-tauri" / "binaries"


def main() -> int:
    dist = HERE / "dist"
    build = HERE / "build"
    for path in (dist, build):
        shutil.rmtree(path, ignore_errors=True)

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--onedir",
            "--console",
            "--name",
            NAME,
            "--collect-all",
            "pypdfium2",
            "--collect-all",
            "pypdfium2_raw",
            "--collect-all",
            "pdfminer",
            str(HERE / "main.py"),
        ],
        cwd=HERE,
    )
    if result.returncode != 0:
        return result.returncode

    built = dist / NAME / f"{NAME}.exe"
    if not built.exists():
        raise SystemExit(f"expected {built} to exist")

    # Replace wholesale rather than merge: a stale library left behind from an earlier
    # build is a bug that reproduces on one machine and nowhere else.
    shutil.rmtree(SIDECAR_DIR, ignore_errors=True)
    shutil.move(str(dist / NAME), str(SIDECAR_DIR))

    print(f"\nengine staged at {SIDECAR_DIR / f'{NAME}.exe'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
