"""The conversion domain model.

A translation of src/converter/types.ts, field for field and name for name. Everything
downstream — the extractor, the raster hints, the HTML and React generators, the tests —
consumes these shapes, so they are declared once here rather than re-described at each
boundary.

Kept deliberately close to the TypeScript rather than made Pythonic. The two
implementations are checked against each other on the same fixtures, and a model that
renamed half its fields on the way over would turn every mismatch into an argument about
whether it is a real difference or a translation artefact.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

Direction = Literal["ltr", "rtl"]

# What paints a page, and therefore how it should be rasterised.
#
# `photographic` compresses well as JPEG and would be several times larger as PNG for no
# visible gain. `lineArt` must be PNG: JPEG rings around glyph and vector edges, and on
# output that promises an exact copy that ringing is the whole failure. `text` needs no
# raster at all — the text layer already reproduces it.
PageKind = Literal["photographic", "lineArt", "text"]

Phase = Literal["extract", "render", "generate"]

WarningCode = Literal["SCANNED", "GRAPHICS_DROPPED", "TRUNCATED"]


@dataclass(slots=True)
class TextRun:
    """A run of glyphs sharing one font and one transform, positioned in CSS pixels."""

    text: str
    #: Left edge at scale 1.
    x: float
    #: Top edge at scale 1.
    y: float
    #: Advance width.
    width: float
    #: Font size in pixels.
    size: float
    #: Rotation in radians; 0 for the overwhelming majority of runs.
    angle: float
    #: Key into the page's font table.
    font: str
    #: Whether the run contains right-to-left script.
    rtl: bool


@dataclass(slots=True)
class FontDescription:
    """A font resolved to something a browser can actually render."""

    #: Ready-to-use CSS stack, e.g. `'Alef', sans-serif`. Single-quoted deliberately.
    family: str
    weight: int
    style: Literal["normal", "italic"]
    #: The generic the stack falls back to.
    generic: str
    #: The embedded name with its subset prefix stripped, e.g. `Alef-Regular`.
    name: str
    vertical: bool = False
    ascent: float = 0.0
    descent: float = 0.0


@dataclass(slots=True)
class PageStats:
    """How much of a page is painted rather than typed — decides whether it needs a raster."""

    vector: int
    images: int
    total: int


@dataclass(slots=True)
class RasterHint:
    kind: PageKind
    format: Literal["jpeg", "png"]
    quality: float


@dataclass(slots=True)
class PageModel:
    number: int
    width: float
    height: float
    runs: list[TextRun] = field(default_factory=list)
    fonts: dict[str, FontDescription] = field(default_factory=dict)
    stats: PageStats = field(default_factory=lambda: PageStats(0, 0, 0))


@dataclass(slots=True)
class DocumentInfo:
    pages: int
    title: str
    producer: str
    #: No text layer on the sampled pages — the output will not be searchable.
    scanned: bool
    has_rtl: bool
    lang: str
    dir: Direction


def round2(value: float, places: int = 2) -> float:
    """Round the way the TypeScript does.

    Not `round()` on its own: Python rounds halves to even and JavaScript's Math.round
    rounds halves up, so 0.125 becomes 0.12 in one and 0.13 in the other. On coordinates
    that difference is invisible; in a test that compares the two models field by field
    it is noise that costs an afternoon.
    """
    factor = 10**places
    scaled = value * factor
    # Math.round semantics: halves go up, including for negatives (-0.5 -> -0).
    return (int(scaled + 0.5) if scaled >= 0 else -int(-scaled + 0.5)) / factor
