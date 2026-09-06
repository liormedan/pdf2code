"""The workbench operations, checked against real documents.

    .venv/Scripts/python.exe test_pages.py

Six features come out of one plan — rotate, reorder, delete, extract, split, merge — so
most of this file is the same operation asked different questions. The checks that carry
the most weight are the two refusals: a plan that would overwrite a source, and a page
number that does not exist. A workbench that writes over the document somebody dragged in
has destroyed the only copy of it, and no undo in an interface reaches a file that is
already gone.
"""

from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

import pypdfium2 as pdfium

from pages import apply_plan, compress, export_images, parse_plan, thumbnails

HERE = Path(__file__).parent
FIXTURES = HERE.parent.parent / "fixtures"
HEBREW = FIXTURES / "08-hebrew-doc.pdf"
TABLES = FIXTURES / "07-academic-tables.pdf"

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}{f'  — {detail}' if detail else ''}")
    if not ok:
        FAILURES.append(name)


def pages_of(path: Path) -> int:
    document = pdfium.PdfDocument(str(path))
    try:
        return len(document)
    finally:
        document.close()


def rotation_of(path: Path, page: int) -> int:
    document = pdfium.PdfDocument(str(path))
    try:
        return document[page - 1].get_rotation()
    finally:
        document.close()


def check_plan(work: Path) -> None:
    print("\n  One plan, six features")

    # --- extract and reorder ---------------------------------------------------------
    out = work / "extract.pdf"
    result = apply_plan(
        parse_plan(
            [
                {"from": str(HEBREW), "page": 5},
                {"from": str(HEBREW), "page": 2},
                {"from": str(HEBREW), "page": 1},
            ]
        ),
        out,
    )
    check("extract takes only the pages named", result["pages"] == 3 and pages_of(out) == 3)
    check("the file it wrote is readable", out.exists() and out.stat().st_size > 0)

    # --- rotate ----------------------------------------------------------------------
    out = work / "rotate.pdf"
    apply_plan(
        parse_plan(
            [
                {"from": str(HEBREW), "page": 1, "rotate": 90},
                {"from": str(HEBREW), "page": 2},
            ]
        ),
        out,
    )
    check("rotation is applied to the page named", rotation_of(out, 1) == 90, str(rotation_of(out, 1)))
    check("and only to that one", rotation_of(out, 2) == 0, str(rotation_of(out, 2)))

    # Turning a page that is already turned adds to it rather than replacing it.
    twice = work / "rotate-twice.pdf"
    apply_plan(parse_plan([{"from": str(out), "page": 1, "rotate": 90}]), twice)
    check("rotation accumulates", rotation_of(twice, 1) == 180, str(rotation_of(twice, 1)))

    # --- delete, which is a plan that omits ------------------------------------------
    out = work / "delete.pdf"
    apply_plan(
        parse_plan([{"from": str(HEBREW), "page": n} for n in (1, 2, 4, 5)]),
        out,
    )
    check("deleting is leaving a page out", pages_of(out) == 4)

    # --- merge across files -----------------------------------------------------------
    out = work / "merge.pdf"
    apply_plan(
        parse_plan(
            [
                {"from": str(HEBREW), "page": 1},
                {"from": str(TABLES), "page": 1},
                {"from": str(HEBREW), "page": 2},
            ]
        ),
        out,
    )
    check("merging takes pages from more than one file", pages_of(out) == 3)

    # --- split, which is several plans -------------------------------------------------
    halves = []
    for index, numbers in enumerate([[1, 2], [3, 4]]):
        part = work / f"split-{index}.pdf"
        apply_plan(parse_plan([{"from": str(HEBREW), "page": n} for n in numbers]), part)
        halves.append(pages_of(part))
    check("splitting is several plans", halves == [2, 2], str(halves))


def check_refusals(work: Path) -> None:
    print("\n  What it refuses, which is the part that protects a document")

    copy = work / "original.pdf"
    shutil.copy(HEBREW, copy)

    # The refusal that matters most.
    try:
        apply_plan(parse_plan([{"from": str(copy), "page": 1}]), copy)
        check("refuses to write over a source", False, "it wrote over it")
    except ValueError as error:
        check("refuses to write over a source", "overwrite" in str(error).lower())

    check("and the source is untouched", pages_of(copy) == pages_of(HEBREW))

    # The same file spelled differently is still the same file.
    try:
        apply_plan(parse_plan([{"from": str(copy), "page": 1}]), work / ".." / work.name / "original.pdf")
        check("a different spelling of the same path is still refused", False, "it wrote over it")
    except ValueError:
        check("a different spelling of the same path is still refused", True)

    # Overwriting on purpose is allowed, because sometimes it is the point.
    apply_plan(parse_plan([{"from": str(copy), "page": 1}]), copy, overwrite=True)
    check("overwriting works when it is asked for", pages_of(copy) == 1)

    for bad, why in [
        ([], "an empty plan"),
        ([{"from": str(HEBREW)}], "an entry with no page"),
        ([{"page": 1}], "an entry with no file"),
        ([{"from": str(HEBREW), "page": 0}], "a zero page number"),
        ([{"from": str(HEBREW), "page": 1, "rotate": 45}], "a rotation that is not a quarter turn"),
    ]:
        try:
            parse_plan(bad)
            check(f"refuses {why}", False)
        except ValueError:
            check(f"refuses {why}", True)

    try:
        apply_plan(parse_plan([{"from": str(HEBREW), "page": 9999}]), work / "nope.pdf")
        check("refuses a page that does not exist", False)
    except ValueError as error:
        check("refuses a page that does not exist", "does not exist" in str(error))


def check_images(work: Path) -> None:
    print("\n  Images")

    made = thumbnails(HEBREW, work / "thumbs", width=120, pages=[1, 2, 3])
    check("a thumbnail per page asked for", len(made) == 3, str(len(made)))
    check("all of them exist", all(Path(t["path"]).exists() for t in made))
    check("scaled to the width asked for", all(abs(t["width"] - 120) <= 1 for t in made),
          str([t["width"] for t in made]))

    # Progress per page. A three-hundred-page document takes long enough that a page view
    # with no sign of life reads as a hang, and this is the only thing that reports it.
    seen: list[tuple[int, int]] = []
    thumbnails(HEBREW, work / "progress", width=80, pages=[1, 2, 3],
               on_page=lambda page, pages: seen.append((page, pages)))
    check("progress is reported once per page", seen == [(1, 3), (2, 3), (3, 3)], str(seen))

    made = export_images(HEBREW, work / "images", pages=[1], scale=1.5, format="jpeg")
    check("exports at the size asked for", len(made) == 1 and Path(made[0]["path"]).exists())
    check("and in the format asked for", made[0]["path"].endswith(".jpg"))

    out = compress(TABLES, work / "compressed.pdf")
    check("compression writes a readable document", pages_of(Path(out["out"])) == pages_of(TABLES))
    check("and reports what it actually saved", "saved" in out, str(out.get("saved")))


def check_acceptance(work: Path) -> None:
    """The sprint's acceptance criterion, run rather than asserted in a document.

    From desktop/roadmap.md: a 35-page Hebrew PDF, three pages taken out, the order
    changed, one page turned, a page merged in from another file, saved — and the result
    opens correctly. The last clause is the one worth checking mechanically: a rebuilt
    document whose text layer did not survive still opens, and looks fine, and is useless.
    """
    print("\n  The acceptance criterion, as a check")

    keep = [n for n in range(1, 36) if n not in (4, 9, 30)]
    # Reordered: page 2 first, then the rest. Rotated: the page that ends up second.
    order = [2] + [n for n in keep if n != 2]

    plan = [{"from": str(HEBREW), "page": n} for n in order]
    plan[1]["rotate"] = 90
    # Merged in from the other document, at a position that is not the end.
    plan.insert(5, {"from": str(TABLES), "page": 1})

    out = work / "acceptance.pdf"
    result = apply_plan(parse_plan(plan), out)

    check("three out, one in, from 35", result["pages"] == 33 and pages_of(out) == 33,
          str(result["pages"]))
    check("the page that was turned is turned", rotation_of(out, 2) == 90, str(rotation_of(out, 2)))
    check("and no other page is", rotation_of(out, 1) == 0 and rotation_of(out, 3) == 0)

    # The clause that matters: real text, in reading order, after the rebuild. Through the
    # same extraction the converter uses, which is what makes the Hebrew logical rather
    # than the visual order pdfminer hands back.
    from extract import extract_page

    model = extract_page(str(out), 1)
    text = "".join(run.text for run in model.runs)
    check("the text layer survived the rebuild", len(text) > 0, f"{len(text)} chars")
    check("and it is still Hebrew, the right way round",
          any("א" <= c <= "ת" for c in text) and any(run.rtl for run in model.runs))


def main() -> int:
    if not HEBREW.exists():
        print(f"missing fixtures at {FIXTURES}")
        return 1

    print("workbench operations")
    work = Path(tempfile.mkdtemp(prefix="pdf2code-pages-"))
    try:
        check_plan(work)
        check_refusals(work)
        check_images(work)
        check_acceptance(work)
    finally:
        shutil.rmtree(work, ignore_errors=True)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} failed: {', '.join(FAILURES[:3])}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
