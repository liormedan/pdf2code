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

from pages import apply_plan, compress, compress_plan, export_images, parse_plan, thumbnails
from protocol import Refusal

HERE = Path(__file__).parent
FIXTURES = HERE.parent.parent / "fixtures"
HEBREW = FIXTURES / "08-hebrew-doc.pdf"
TABLES = FIXTURES / "07-academic-tables.pdf"
SCANNED = FIXTURES / "04-scanned-ccitt.pdf"

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

    # The page view is this operation at a larger width, so the guarantee it leans on is
    # that asking for page N draws page N. Nothing else in the viewer can recover from
    # that being wrong: it would show a page confidently and show the wrong one.
    one = thumbnails(HEBREW, work / "view", width=700, pages=[1])
    seven = thumbnails(HEBREW, work / "view", width=700, pages=[7])
    check("asking for one page renders exactly that page",
          [t["page"] for t in one] == [1] and [t["page"] for t in seven] == [7])
    check("and names the file after the page, not the request order",
          Path(one[0]["path"]).name == "thumb-1.png"
          and Path(seven[0]["path"]).name == "thumb-7.png",
          Path(seven[0]["path"]).name)
    check("so two different pages are two different files",
          Path(one[0]["path"]).read_bytes() != Path(seven[0]["path"]).read_bytes())

    # The viewer keeps a directory per width. Were they shared, the 170px strip and a
    # 700px page would both be `thumb-1.png` and the last render would win — which looks
    # like the viewer showing a blurry page, or the strip showing a huge one.
    small = thumbnails(HEBREW, work / "strip", width=170, pages=[1])
    check("the same page at two widths is two files in two directories",
          Path(small[0]["path"]) != Path(one[0]["path"])
          and abs(small[0]["width"] - 170) <= 1 and abs(one[0]["width"] - 700) <= 1)

    # A scanned page has no text layer and renders perfectly well. The viewer says so
    # rather than looking broken, and this is the half of that claim the engine owns.
    if SCANNED.exists():
        scan = thumbnails(SCANNED, work / "scan", width=700, pages=[1])
        check("a scanned page renders like any other",
              len(scan) == 1 and Path(scan[0]["path"]).exists()
              and abs(scan[0]["width"] - 700) <= 1)

    # Progress per page. A three-hundred-page document takes long enough that a page view
    # with no sign of life reads as a hang, and this is the only thing that reports it.
    seen: list[tuple[int, int]] = []
    thumbnails(HEBREW, work / "progress", width=80, pages=[1, 2, 3],
               on_page=lambda page, pages: seen.append((page, pages)))
    check("progress is reported once per page", seen == [(1, 3), (2, 3), (3, 3)], str(seen))

    made = export_images(parse_plan([{"from": str(HEBREW), "page": 1}]), work / "images",
                         scale=1.5, format="jpeg")
    check("exports at the size asked for", len(made) == 1 and Path(made[0]["path"]).exists())
    check("and in the format asked for", made[0]["path"].endswith(".jpg"))

    # The three things the old signature discarded, in one plan: an order that is not
    # ascending, a page taken twice, and a rotation. Sorting, de-duplicating or dropping
    # the angle each breaks exactly one of these three, so all three are asserted.
    turned = parse_plan([
        {"from": str(HEBREW), "page": 3},
        {"from": str(HEBREW), "page": 1},
        {"from": str(HEBREW), "page": 1, "rotate": 90},
    ])
    made = export_images(turned, work / "ordered", scale=0.5)
    check("a plan exports one image per entry, duplicates included", len(made) == 3,
          str(len(made)))
    check("in the order of the plan and not of the page numbers",
          [item["page"] for item in made] == [3, 1, 1],
          str([item["page"] for item in made]))
    check("with names that sort into that order",
          [Path(item["path"]).name.split("-")[0] for item in made] == ["1", "2", "3"],
          str([Path(item["path"]).name for item in made]))
    check("and two copies of one page are two files",
          made[1]["path"] != made[2]["path"])

    from PIL import Image  # noqa: PLC0415
    upright = Image.open(made[1]["path"]).size
    quarter = Image.open(made[2]["path"]).size
    # A quarter turn swaps width and height. This is the only assertion that can tell a
    # rotated export from an unrotated one without comparing pixels.
    check("a rotated entry is exported rotated", quarter == (upright[1], upright[0]),
          f"{upright} then {quarter}")

    out = compress(TABLES, work / "compressed.pdf")
    check("compression writes a readable document", pages_of(Path(out["out"])) == pages_of(TABLES))
    check("and reports what it actually saved", "saved" in out, str(out.get("saved")))


def check_compress_plan(work: Path) -> None:
    """Compression measured against the documents somebody has, not the staged copy.

    Every case checks the same three things the window used to leave to luck: the
    staged copy is gone, the output is exactly what was promised (a file, or no file),
    and no source has changed by a byte.
    """
    print("\n  compressing a plan")
    scratch = work / "scratch"

    def staged_gone(name: str) -> None:
        check(f"{name}: staged copy removed", not (scratch / "staged.pdf").exists())

    # --- the case that was measured in the app: 1.54 MB in, 3.58 MB out ---------------
    whole = parse_plan([{"from": str(HEBREW), "page": n} for n in range(1, 36)])
    source_bytes = HEBREW.read_bytes()
    out = work / "smaller.pdf"
    try:
        compress_plan(whole, out, scratch)
        check("a rewrite that is not smaller is refused", False, "no refusal")
    except Refusal as refusal:
        check("a rewrite that is not smaller is refused", refusal.code == "NOT_SMALLER", refusal.code)
        before, after = (int(n) for n in refusal.message.split())
        check(
            "and the numbers are the source and the result, not the staged copy",
            before == HEBREW.stat().st_size and after > before,
            f"{before} -> {after}",
        )
    check("the not-smaller output is deleted, not delivered", not out.exists())
    staged_gone("not smaller")
    check("the source is untouched", HEBREW.read_bytes() == source_bytes)

    # --- a document that really does shrink: a small one padded with junk ---------------
    padded = work / "padded.pdf"
    padded.write_bytes(TABLES.read_bytes() + b"%" * 2_000_000)
    plan = parse_plan([{"from": str(padded), "page": 1}])
    result = compress_plan(plan, work / "shrunk.pdf", scratch)
    check(
        "a document with waste in it comes out smaller",
        result["saved"] > 0 and Path(result["out"]).stat().st_size == result["after"],
        f"{result['before']} -> {result['after']}",
    )
    check("before is the size of the source file", result["before"] == padded.stat().st_size)
    check("the result opens", pages_of(Path(result["out"])) == 1)
    staged_gone("success")

    # --- an output that is a source, however it is spelled ----------------------------
    copy = work / "Original.pdf"
    copy.write_bytes(TABLES.read_bytes())
    original = copy.read_bytes()
    plan = parse_plan([{"from": str(copy), "page": 1}])
    for spelled in (copy, work / "original.PDF", work / "sub" / ".." / "Original.pdf"):
        try:
            compress_plan(plan, spelled, scratch)
            check(f"writing over a source is refused ({spelled.name})", False, "no refusal")
        except Refusal as refusal:
            check(
                f"writing over a source is refused ({spelled.name})",
                refusal.code == "SOURCE_OVERWRITE",
                refusal.code,
            )
        except OSError as failure:
            # `resolve()` may fail on a spelling that does not exist; that is still a "no".
            check(f"writing over a source is refused ({spelled.name})", False, repr(failure))
    check("and the source is byte-for-byte what it was", copy.read_bytes() == original)
    staged_gone("source overwrite")

    # --- a failure on the way out: the output cannot be written -------------------------
    blocked = work / "not-a-folder.pdf"
    blocked.write_bytes(b"x")
    try:
        compress_plan(plan, blocked / "inside-a-file.pdf", scratch)
        check("an unwritable output fails", False, "no failure")
    except Refusal as refusal:
        check("an unwritable output fails", False, f"refused as {refusal.code} instead")
    except OSError:
        check("an unwritable output fails", True)
    staged_gone("failure")


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
        check_compress_plan(work)
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
