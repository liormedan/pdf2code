"""PDF page -> plain structured model.

A translation of src/converter/extract.ts onto pdfminer.six. Deliberately free of any
rendering: the model is plain data, so the same extraction feeds the generators, the
tests and the interface.

**The coordinate mapping, derived rather than guessed.** pdf.js reports positions after
composing the page transform with a viewport that flips the y axis; pdfminer reports
them in PDF space, y up from the bottom. Composing pdf.js's viewport `[1,0,0,-1,0,h]`
with a text item's matrix `[a,b,c,d,e,f]` gives `[a, -b, c, -d, e, h-f]`, which is where
each line below comes from:

    x     = matrix[4]                      # unchanged by the flip
    y     = height - matrix[5] - size      # h-f, then up by one line to the top edge
    angle = atan2(-matrix[1], matrix[0])   # note the sign: the flip negates b

Checked against the TypeScript on 08-hebrew-doc.pdf, where the first run lands on
x=149.4, y=58.36, size=32 in both. Not approximately — the same numbers.

**Size does not come from the matrix.** pdf.js folds the font size into the item
transform, so `hypot(c, d)` is the size there. pdfminer keeps them apart: the matrix
carries only the text-space scale (0.75 in that fixture) and `LTChar.size` carries the
product (32). Taking the matrix would silently produce text a fortieth of its size.

**Runs are ours, not the library's.** pdf.js hands back text items it grouped itself;
pdfminer hands back characters. Grouping them is the one piece of real logic here rather
than translation, so where the two implementations split a line differs — and the parity
checks compare reassembled lines, not run boundaries.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator

from pdfminer.high_level import extract_pages
from pdfminer.layout import LAParams, LTAnno, LTChar, LTCurve, LTFigure, LTImage, LTLine, LTRect, LTTextContainer
from pdfminer.pdfdocument import PDFDocument
from pdfminer.pdfpage import PDFPage
from pdfminer.pdfparser import PDFParser

from bidi import bidi
from fonts import resolve_page_fonts
from language import detect_language, is_rtl
from model import DocumentInfo, PageModel, PageStats, TextRun, round2

# How far apart two characters may sit and still belong to one run, as a fraction of the
# font size. Generous on purpose: a gap wider than this is a column boundary or a tab
# stop, and joining across it produces a run whose width is mostly empty space.
GAP_TOLERANCE = 0.6

# Below this much text across the sampled pages, the document is a scan. Carried over
# from extract.ts, where the same number decides whether to warn that the output will
# not be searchable.
SCANNED_BELOW = 30

# How many pages `inspect` reads to judge the language. Title pages are often a logo and
# three words, which is far too little to go on.
SAMPLE_PAGES = 3


@dataclass(slots=True)
class _Glyph:
    """One character, already mapped into CSS pixel space.

    `along` and `across` are the position measured in the run's own frame rather than
    the page's: distance in the writing direction, and distance perpendicular to it.
    For ordinary horizontal text they are simply x and y. For the rotated sidebar text
    on an arXiv paper they are not, which is the whole reason they exist — grouping
    rotated glyphs by x alone turns a title into thirty-seven single-character runs.
    """

    text: str
    x: float
    y: float
    advance: float
    size: float
    angle: float
    font: str
    along: float
    across: float
    #: Unit vector of the writing direction in CSS space; (1, 0) for horizontal text.
    ax: float = 1.0
    ay: float = 0.0
    #: An inferred space that precedes this glyph in reading order, if any.
    space_before: str = ""


def _glyph(char: LTChar, page_height: float) -> _Glyph | None:
    a, b, _c, _d, e, f = char.matrix

    # pdfminer reports `size` as the laid-out bounding box's *height*, which is the font
    # size only while the text is upright. Rotate the text ninety degrees and the axes
    # swap: on the arXiv sidebar, `size` reads 10 (the advance) where the real size is
    # 20 (the box's width). pdfminer already tracks which case it is, so ask it.
    size = float(char.width if not char.upright else char.size)
    if size <= 0:
        return None

    # atan2(-b, a): the viewport flip negates b, and getting that sign wrong tilts every
    # rotated run the wrong way while leaving the overwhelming majority of documents,
    # which have no rotated text at all, looking perfectly fine.
    angle = 0.0 if b == 0 and _c == 0 else math.atan2(-b, a)

    x = float(e)
    y = page_height - float(f) - size

    # The writing direction in CSS space. A PDF text x-axis of (a, b) becomes (a, -b)
    # once y points down, so this reduces to (1, 0) for horizontal text and everything
    # below then reads as plain x and y.
    scale = math.hypot(a, b) or 1.0
    ax, ay = a / scale, -b / scale

    return _Glyph(
        text=char.get_text(),
        x=x,
        y=y,
        # `adv` is in text space; the matrix scale brings it into device space.
        advance=float(char.adv) * scale,
        size=size,
        angle=angle,
        font=char.fontname,
        along=x * ax + y * ay,
        across=-x * ay + y * ax,
        ax=ax,
        ay=ay,
    )


def _same_run(previous: _Glyph, current: _Glyph) -> bool:
    """Whether two adjacent glyphs belong to the same run."""
    if previous.font != current.font:
        return False
    if round2(previous.size) != round2(current.size):
        return False
    if round2(previous.angle, 4) != round2(current.angle, 4):
        return False
    # Same line: a shifted baseline is a new run even mid-sentence.
    if abs(previous.across - current.across) > 0.5:
        return False
    # Contiguous: the next glyph starts roughly where the last one ended, measured in
    # the writing direction rather than along the page.
    expected = previous.along + previous.advance
    return abs(current.along - expected) <= current.size * GAP_TOLERANCE


def _ordered(glyphs: list[_Glyph]) -> list[_Glyph]:
    """Put glyphs into reading order within each line.

    pdfminer lays a page out top to bottom, which is reading order for horizontal text
    and backwards for text rotated ninety degrees — the arXiv sidebar arrives ending
    first. Sorting each line by its own writing direction fixes that without disturbing
    ordinary text, where `along` is just x and the order is already correct.
    """
    ordered: list[_Glyph] = []
    line: list[_Glyph] = []

    def flush_line() -> None:
        if not line:
            return
        sorted_line = sorted(line, key=lambda g: g.along)
        # pdfminer reports an inferred space as belonging *before* the character that
        # follows it in stream order. Reversing the line reverses that adjacency too:
        # the gap that sat before a glyph now sits after it. Shifting each marker one
        # place forward restores the pairing — without this the arXiv sidebar keeps its
        # spaces but puts every one of them a character too early.
        if len(sorted_line) > 1 and line[0].along > line[-1].along:
            markers = [g.space_before for g in sorted_line]
            for glyph, marker in zip(sorted_line, [""] + markers[:-1]):
                glyph.space_before = marker
        ordered.extend(sorted_line)
        line.clear()

    for glyph in glyphs:
        if line and (
            round2(line[-1].angle, 4) != round2(glyph.angle, 4)
            or abs(line[-1].across - glyph.across) > 0.5
        ):
            flush_line()
        line.append(glyph)

    flush_line()
    return _place_spaces(ordered)


def _place_spaces(glyphs: list[_Glyph]) -> list[_Glyph]:
    """Give each inferred space the gap it stands for, now that order is known.

    A space is as wide as the distance between where the previous glyph ended and where
    the next one starts, measured in the writing direction — so it stays correct for
    rotated text, and a run's width stays the width it actually occupies.
    """
    placed: list[_Glyph] = []

    for glyph in glyphs:
        if glyph.space_before and placed:
            previous = placed[-1]
            along = previous.along + previous.advance
            # Only if there is a gap and the neighbours share a line; a space between
            # two lines is a line break, which the run boundary already expresses.
            if glyph.along > along and abs(previous.across - glyph.across) <= 0.5:
                placed.append(
                    _Glyph(
                        text=glyph.space_before,
                        x=previous.x + previous.advance * previous.ax,
                        y=previous.y + previous.advance * previous.ay,
                        advance=glyph.along - along,
                        size=previous.size,
                        angle=previous.angle,
                        font=previous.font,
                        along=along,
                        across=previous.across,
                        ax=previous.ax,
                        ay=previous.ay,
                    )
                )
        placed.append(glyph)

    return placed


def _runs_from(glyphs: list[_Glyph]) -> Iterator[TextRun]:
    group: list[_Glyph] = []

    def flush() -> Iterator[TextRun]:
        if not group:
            return
        # Visual order in, logical order out. pdfminer hands back glyphs in the order
        # the page paints them, which for Hebrew and Arabic is already reversed — see
        # bidi.py, and see business/situations.md situation 5 for why this one line is
        # the difference between the product we are selling and a broken converter.
        text = bidi("".join(g.text for g in group)).text
        # Blank runs still carry layout meaning in tables, but empty ones are noise.
        width = sum(g.advance for g in group)
        if text.strip() or width > 0:
            first = group[0]
            yield TextRun(
                text=text,
                x=round2(first.x),
                y=round2(first.y),
                width=round2(width),
                size=round2(first.size),
                angle=round2(first.angle, 4),
                font=first.font,
                rtl=is_rtl(text),
            )

    for glyph in glyphs:
        if group and not _same_run(group[-1], glyph):
            yield from flush()
            group = []
        group.append(glyph)

    yield from flush()


def _count_paint(layout) -> PageStats:
    """How much of the page is painted rather than typed.

    Not a translation. extract.ts counts pdf.js painting operators; pdfminer reports a
    laid-out tree instead, so the counts cannot be the same number and the parity checks
    do not ask them to be. What has to agree is the decision they feed: whether a page
    needs a raster layer at all.
    """
    vector = 0
    images = 0
    total = 0

    def walk(node) -> None:
        nonlocal vector, images, total
        for item in node:
            total += 1
            if isinstance(item, (LTImage, LTFigure)):
                images += 1
                if isinstance(item, LTFigure):
                    walk(item)
            elif isinstance(item, (LTLine, LTRect, LTCurve)):
                vector += 1
            elif isinstance(item, LTTextContainer):
                pass

    walk(layout)
    return PageStats(vector=vector, images=images, total=total)


def _chars(layout) -> Iterator[LTChar | LTAnno]:
    """Every character on the page, in the order pdfminer laid it out.

    `LTAnno` is included, and leaving it out was a real bug rather than a nicety. Many
    PDFs never encode a space glyph at all — the gap between two words is a positioning
    adjustment in the content stream, and pdfminer reports the inferred space as an
    `LTAnno`, which has text but no geometry. Filtering to `LTChar` therefore produced
    `'Providedproperattributionisprovided,'`: every coordinate correct to the last
    decimal, and every word run together.
    """

    def walk(node) -> Iterator[LTChar | LTAnno]:
        for item in node:
            if isinstance(item, (LTChar, LTAnno)):
                yield item
            elif isinstance(item, (LTTextContainer, LTFigure)) or hasattr(item, "__iter__"):
                try:
                    yield from walk(item)
                except TypeError:
                    continue

    yield from walk(layout)


def _glyphs(items: Iterable[LTChar | LTAnno], page_height: float) -> list[_Glyph]:
    """Map characters into CSS pixel space, remembering which ones follow a space.

    An `LTAnno` carries text but no position: it is pdfminer's way of reporting a space
    the document never encoded as a glyph, inferred from the gap between two words. It
    is attached to the character that *follows* it rather than placed immediately,
    because placing it here would use the neighbouring glyph in pdfminer's own order —
    and for text rotated ninety degrees that order is reversed, which put every space in
    the arXiv sidebar somewhere else on the page. Reading order is established later, in
    `_ordered`, and the space is only given a position once the gap it fills is known.
    """
    glyphs: list[_Glyph] = []
    pending: list[str] = []

    for item in items:
        if isinstance(item, LTAnno):
            text = item.get_text()
            # A newline is a line break, not a character. It ends the run rather than
            # joining it, which the geometry checks in _same_run then handle.
            if text and not text.startswith("\n"):
                pending.append(text)
            continue

        glyph = _glyph(item, page_height)
        if glyph is None:
            continue

        if pending:
            glyph.space_before = "".join(pending)
        pending.clear()
        glyphs.append(glyph)

    return glyphs


def extract_page(path: str | Path, number: int, laparams: LAParams | None = None) -> PageModel:
    """Extract one page (1-based) into a renderer-agnostic model."""
    pages = list(
        extract_pages(str(path), page_numbers=[number - 1], laparams=laparams or LAParams())
    )
    if not pages:
        raise ValueError(f"page {number} not found in {path}")
    layout = pages[0]

    glyphs = _glyphs(_chars(layout), layout.height)
    runs = list(_runs_from(_ordered(glyphs)))

    return PageModel(
        number=number,
        width=round2(layout.width),
        height=round2(layout.height),
        runs=runs,
        fonts=resolve_page_fonts(g.font for g in glyphs),
        stats=_count_paint(layout),
    )


def _metadata_string(value: object) -> str:
    """PDF metadata arrives as bytes, as a str, or as something else entirely."""
    if isinstance(value, bytes):
        for encoding in ("utf-16", "utf-8", "latin-1"):
            try:
                return value.decode(encoding).strip("\x00").strip()
            except UnicodeDecodeError:
                continue
        return ""
    return str(value).strip() if value is not None else ""


def inspect(path: str | Path) -> DocumentInfo:
    """Whole-document metadata, gathered before any page work."""
    path = Path(path)

    with path.open("rb") as handle:
        document = PDFDocument(PDFParser(handle))
        pages = sum(1 for _ in PDFPage.create_pages(document))
        info = document.info[0] if document.info else {}
        title = _metadata_string(info.get("Title"))
        producer = _metadata_string(info.get("Producer"))

    sample_parts: list[str] = []
    for layout in extract_pages(str(path), maxpages=min(pages, SAMPLE_PAGES)):
        sample_parts.extend(char.get_text() for char in _chars(layout))
    sample = "".join(sample_parts)

    lang, direction = detect_language(sample)

    return DocumentInfo(
        pages=pages,
        title=title,
        producer=producer,
        # A page with no text is a scan; the raster layer will carry it, but the text
        # layer will be empty and the output will not be searchable without OCR.
        scanned=len(sample.strip()) < SCANNED_BELOW,
        has_rtl=is_rtl(sample),
        lang=lang,
        dir=direction,
    )
