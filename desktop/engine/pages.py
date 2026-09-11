"""Operations on the document itself: pages in, pages out.

One idea does all of it. A **plan** is a list saying which page of which file goes where
and how it is turned:

    [{"from": "a.pdf", "page": 3, "rotate": 90},
     {"from": "b.pdf", "page": 1}]

Rotation, reordering and deletion are what the list says; extraction is a shorter list;
splitting is several plans; merging is a plan naming more than one file. Six features
that would have been six operations are one, because that is the shape pypdfium2 already
has — and because a single operation is a single place to get the refusals right.

**Nothing here overwrites a source unless it is told to.** A workbench that quietly
writes over the document somebody dragged in has destroyed the only copy of it, and no
undo in the interface reaches a file that is already gone. `apply_plan` refuses an output
path that is also an input, and the refusal is not overridable by accident — the caller
has to say `overwrite`.

Measured before it was written: extract, reorder, rotate, delete, merge across files and
save all work on the Hebrew fixture with pypdfium2 alone, no new dependency. That is why
this is a tenth of the product rather than a second one.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

import pypdfium2 as pdfium

from protocol import Refusal

#: Rotation is quarter turns; PDF stores nothing else, and pretending otherwise would
#: mean re-rendering a page to tilt it five degrees.
ROTATIONS = (0, 90, 180, 270)


@dataclass(slots=True)
class PagePlan:
    source: str
    #: 1-based, the way a person counts pages.
    page: int
    rotate: int = 0


def parse_plan(entries: Iterable[dict]) -> list[PagePlan]:
    plan: list[PagePlan] = []
    for entry in entries:
        source = entry.get("from")
        page = entry.get("page")
        rotate = int(entry.get("rotate", 0)) % 360

        if not isinstance(source, str) or not source:
            raise ValueError("every plan entry needs a 'from'")
        if not isinstance(page, int) or page < 1:
            raise ValueError("every plan entry needs a 1-based 'page'")
        if rotate not in ROTATIONS:
            raise ValueError(f"rotate must be one of {ROTATIONS}, not {rotate}")

        plan.append(PagePlan(source=source, page=page, rotate=rotate))

    if not plan:
        raise ValueError("the plan is empty; a document with no pages is not a document")
    return plan


def apply_plan(plan: list[PagePlan], out: str | Path, *, overwrite: bool = False) -> dict:
    """Build a new document from the plan and write it to `out`."""
    out = Path(out)

    # The refusal that matters. Resolved on both sides, because "the same file" reached
    # by two different spellings is still the same file.
    sources = {Path(entry.source).resolve() for entry in plan}
    if not overwrite and out.resolve() in sources:
        raise ValueError(
            "refusing to write over a source document; pass overwrite to mean it"
        )

    out.parent.mkdir(parents=True, exist_ok=True)

    # Opened once each. A plan that takes forty pages from one file should not open it
    # forty times, and a handle per source is also what lets pypdfium2 copy pages
    # between documents at all.
    opened: dict[str, pdfium.PdfDocument] = {}
    result = pdfium.PdfDocument.new()

    try:
        for index, entry in enumerate(plan):
            document = opened.get(entry.source)
            if document is None:
                document = pdfium.PdfDocument(entry.source)
                opened[entry.source] = document

            if entry.page > len(document):
                raise ValueError(
                    f"{Path(entry.source).name} has {len(document)} pages, "
                    f"so page {entry.page} does not exist"
                )

            result.import_pages(document, [entry.page - 1])

            if entry.rotate:
                # Added to whatever the page already carried: a page stored at 90° that
                # somebody turns another 90° is at 180°, not back at 90°.
                page = result[index]
                page.set_rotation((page.get_rotation() + entry.rotate) % 360)

        result.save(str(out))
    finally:
        for document in opened.values():
            document.close()
        result.close()

    return {"out": str(out), "pages": len(plan), "bytes": out.stat().st_size}


def thumbnails(source: str | Path, out_dir: str | Path, *, width: int = 180,
               pages: list[int] | None = None,
               on_page: Callable[[int, int], None] | None = None) -> list[dict]:
    """Render small page images, for a page view.

    Written to disk and returned as paths. Thumbnails of a three-hundred-page document
    as data URIs would be tens of megabytes through a pipe meant for control.
    """
    source = Path(source)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    document = pdfium.PdfDocument(str(source))
    try:
        wanted = list(pages or range(1, len(document) + 1))
        made: list[dict] = []

        for index, number in enumerate(wanted, start=1):
            # Reported per page: a three-hundred-page document takes long enough that a
            # page view with no sign of life reads as a hang.
            if on_page is not None:
                on_page(index, len(wanted))
            if number < 1 or number > len(document):
                continue
            page = document[number - 1]
            # Scale from the page's own width, so a thumbnail of a wide page and a tall
            # one are the same width rather than the same scale.
            scale = width / max(1.0, page.get_width())
            image = page.render(scale=scale).to_pil()
            path = out_dir / f"thumb-{number}.png"
            image.save(path, format="PNG", optimize=True)
            made.append(
                {"page": number, "path": str(path), "width": image.width, "height": image.height}
            )

        return made
    finally:
        document.close()


def export_images(plan: list[PagePlan], out_dir: str | Path, *, scale: float = 2.0,
                  format: str = "png",
                  on_page: Callable[[int, int], None] | None = None) -> list[dict]:
    """Export the plan as images, at a size worth keeping.

    **A plan and not a page list, for the same reason `apply_plan` takes one.** This used
    to take one source and a list of page numbers, and the window built that list by
    collecting the pages of each document, sorting them and removing duplicates. Every one
    of those three steps discarded something somebody had done on purpose: the order they
    dragged the pages into, the page they deliberately kept twice, and — because a bare
    number carries no angle — every rotation.

    So a workbench showing pages 3, 1, 1-turned exported 1, 3, upright. **The images did
    not match the screen, and nothing said so.** A plan cannot express that mismatch,
    because it is the same list the screen is drawn from.

    Names are numbered from the plan rather than from the page, and zero-padded to the
    width of the plan: `007-report-3.png`. A file listing then sorts into the order the
    pages were arranged in, which is the only order that means anything here — and two
    copies of page 3 get two names instead of one file written twice.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if format not in ("png", "jpeg"):
        raise ValueError("format must be png or jpeg")

    suffix = "jpg" if format == "jpeg" else "png"
    width = len(str(len(plan)))

    # One handle per source, as in `apply_plan`: a plan that takes forty pages from one
    # file should not open it forty times.
    opened: dict[str, pdfium.PdfDocument] = {}
    made: list[dict] = []

    try:
        for index, entry in enumerate(plan, start=1):
            if on_page is not None:
                on_page(index, len(plan))

            document = opened.get(entry.source)
            if document is None:
                document = pdfium.PdfDocument(entry.source)
                opened[entry.source] = document

            if entry.page < 1 or entry.page > len(document):
                continue

            # PDFium turns the page as it draws it, so the exported image carries the
            # rotation rather than needing the viewer to know about it.
            image = document[entry.page - 1].render(scale=scale, rotation=entry.rotate).to_pil()
            stem = Path(entry.source).stem
            path = out_dir / f"{index:0{width}d}-{stem}-{entry.page}.{suffix}"

            if format == "jpeg":
                # JPEG has no alpha, and PDFium hands back RGBA for a transparent page.
                image.convert("RGB").save(path, format="JPEG", quality=92, optimize=True)
            else:
                image.save(path, format="PNG", optimize=True)

            made.append(
                {"page": entry.page, "path": str(path), "rotate": entry.rotate, "at": index}
            )

        return made
    finally:
        for document in opened.values():
            document.close()


def compress(source: str | Path, out: str | Path, *, overwrite: bool = False) -> dict:
    """Rewrite the document, letting PDFium drop what nothing references.

    Honest about what it is: object-level tidying, not re-encoding images. A document
    full of photographs will barely move. Saying so is better than a button that
    promises compression and returns the same number.
    """
    source = Path(source)
    out = Path(out)
    if not overwrite and out.resolve() == source.resolve():
        raise ValueError("refusing to write over the source document")

    out.parent.mkdir(parents=True, exist_ok=True)
    document = pdfium.PdfDocument(str(source))
    try:
        document.save(str(out))
    finally:
        document.close()

    before = source.stat().st_size
    after = out.stat().st_size
    return {"out": str(out), "before": before, "after": after, "saved": before - after}


def compress_plan(plan: list[PagePlan], out: str | Path, scratch: str | Path) -> dict:
    """Build the plan into one document, rewrite it, and keep the result only if it is
    smaller than the documents the plan was made from.

    **Measured against the sources, not the staged copy.** The first version compared
    the rewritten file to `staged.pdf`, and on the Hebrew fixture reported "0 KB saved,
    0%" while writing a 3.58 MB file from a 1.54 MB original: importing pages into a new
    document copies shared resources per page, and the comparison never looked at the
    file somebody actually had. A button called "shrink" that more than doubles a file
    and calls it even is worse than no button. So: `before` is what they started with,
    and a result that is not smaller is deleted and reported as `NOT_SMALLER`.

    **An output that is a source is refused before anything is written.** `apply_plan`
    already refuses this for its own output; this refuses it for the final one, because
    the staged copy in between is what the old flow compared against — and the old flow
    would happily have written the final file over the original.

    The staged copy is removed on every path out of here, including the two refusals.
    """
    out = Path(out)
    scratch = Path(scratch)
    sources = {Path(entry.source).resolve() for entry in plan}
    if out.resolve() in sources:
        raise Refusal("SOURCE_OVERWRITE", "refusing to write over a source document")

    before = sum(path.stat().st_size for path in sources)
    scratch.mkdir(parents=True, exist_ok=True)
    staged = scratch / "staged.pdf"
    try:
        apply_plan(plan, staged, overwrite=True)
        result = compress(staged, out)
        after = int(result["after"])
        if after >= before:
            out.unlink(missing_ok=True)
            raise Refusal("NOT_SMALLER", f"{before} {after}")
        return {"out": str(out), "before": before, "after": after, "saved": before - after}
    finally:
        staged.unlink(missing_ok=True)
