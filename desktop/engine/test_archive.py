"""Packing a conversion, and the three refusals that keep it honest.

    .venv/Scripts/python.exe test_archive.py

The one that earns its place is the archive written inside the folder it packs. It does
not fail loudly — the walk finds the growing archive and adds it to itself — so without a
refusal it ships and turns up later as a bug report about an enormous zip.
"""

from __future__ import annotations

import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

from archive import zip_dir

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}{f'  — {detail}' if detail else ''}")
    if not ok:
        FAILURES.append(name)


def main() -> int:
    print("packing a conversion")
    work = Path(tempfile.mkdtemp(prefix="pdf2code-zip-"))
    try:
        # A folder shaped like what a conversion writes.
        source = work / "report-1757000000"
        source.mkdir()
        (source / "index.html").write_text("<p>שלום</p>" * 400, encoding="utf-8")
        (source / "PdfDocument.jsx").write_text("export default function X() {}\n", encoding="utf-8")
        (source / "PdfDocument.css").write_text(".page { position: relative }\n", encoding="utf-8")
        (source / "nested").mkdir()

        out = work / "report.zip"
        result = zip_dir(source, out)

        check("it packs every file", sorted(result["files"]) ==
              ["PdfDocument.css", "PdfDocument.jsx", "index.html"], str(result["files"]))
        check("a directory is not a file", "nested" not in result["files"])
        check("the archive exists and is not empty", out.exists() and result["bytes"] > 0)
        check("deflate actually deflated", result["bytes"] < result["unpacked"],
              f"{result['bytes']} vs {result['unpacked']}")

        with zipfile.ZipFile(out) as archive:
            names = archive.namelist()
            check("names are bare, not paths from somebody's disk",
                  all("/" not in n and "\\" not in n for n in names), str(names))
            check("the Hebrew survives the round trip",
                  "שלום" in archive.read("index.html").decode("utf-8"))
            check("the archive is readable", archive.testzip() is None)

        print("\n  What it refuses")

        # The one that matters.
        try:
            zip_dir(source, source / "inside.zip")
            check("refuses to write the archive inside the folder it packs", False, "it wrote it")
        except ValueError as error:
            check("refuses to write the archive inside the folder it packs",
                  "inside" in str(error))

        # The same folder spelled differently is still the same folder.
        try:
            zip_dir(source, source / ".." / source.name / "sneaky.zip")
            check("a different spelling of that folder is still refused", False)
        except ValueError:
            check("a different spelling of that folder is still refused", True)

        try:
            zip_dir(source, out)
            check("refuses to replace an existing archive", False, "it replaced it")
        except ValueError as error:
            check("refuses to replace an existing archive", "overwrite" in str(error))

        zip_dir(source, out, overwrite=True)
        check("replacing works when it is asked for", out.exists())

        empty = work / "empty"
        empty.mkdir()
        try:
            zip_dir(empty, work / "empty.zip")
            check("refuses an empty folder", False)
        except ValueError:
            check("refuses an empty folder", True)

        try:
            zip_dir(source / "index.html", work / "not-a-folder.zip")
            check("refuses something that is not a folder", False)
        except ValueError:
            check("refuses something that is not a folder", True)
    finally:
        shutil.rmtree(work, ignore_errors=True)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} failed: {', '.join(FAILURES)}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
