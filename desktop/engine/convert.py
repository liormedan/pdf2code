"""Public conversion API.

A translation of src/converter/index.ts. The shape is the same — inspect, extract each
page, decide whether it needs a raster, generate — with one deliberate difference at the
end: **the files are written to disk and their names are returned, rather than being
handed back as strings.**

That is the constraint from desktop/architecture.md §2. A hundred and fifty rasterised
pages as base64 through the sidecar's stdout is tens of megabytes of JSON, and the pipe
is for control, not payload. The engine writes; the window is told where.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Literal

import pypdfium2 as pdfium

from extract import extract_page, inspect
from html_out import to_html
from model import DocumentInfo, PageModel, RasterHint, WarningCode
from raster import as_data_uri, render_page, write_page_image
from react import to_react

OutputFormat = Literal["html", "react"]


class ConversionError(Exception):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(slots=True)
class ConversionWarning:
    """Warnings carry a code and its parameters, not a sentence.

    The engine has no idea what language the reader speaks, and it runs in tests where
    there is no locale at all. It reports *what happened*; the interface decides how to
    say it, using the translations that already exist in messages/. `message` is an
    English fallback for callers with no translator, such as these test scripts.
    """

    code: WarningCode
    params: dict[str, object] = field(default_factory=dict)
    message: str = ""


@dataclass(slots=True)
class ConversionResult:
    info: DocumentInfo
    converted: int
    pages: list[PageModel]
    #: Names of the files written, relative to the output directory.
    files: list[str]
    warnings: list[ConversionWarning]


def classify_page(page: PageModel) -> RasterHint:
    """Decide how a page should be rasterised from what actually paints it.

    Measured against the fixture corpus: pages carrying vector art alongside text are
    the common case in real documents, and compressing those as JPEG puts visible
    ringing around every glyph and rule. That is precisely the artefact an "exact copy"
    cannot have, so those pages go to PNG and only genuinely photographic pages take
    JPEG.

    The thresholds are the TypeScript's. They were tuned against pdf.js operator counts
    and this engine counts laid-out objects instead, so they are checked on the fixtures
    rather than assumed — what has to agree is the `kind` each page is given, not the
    numbers behind it.
    """
    vector = page.stats.vector
    images = page.stats.images
    text = len(page.runs)

    if images > 0 and vector <= 4 and text < 20:
        # A scan or a full-bleed photo. PNG here is several times larger for no gain.
        return RasterHint(kind="photographic", format="jpeg", quality=0.92)
    if vector > 0 or images > 0:
        return RasterHint(kind="lineArt", format="png", quality=1)
    return RasterHint(kind="text", format="png", quality=1)


def convert(
    path: str | Path,
    out_dir: str | Path,
    *,
    formats: list[OutputFormat] | None = None,
    background: bool = True,
    background_scale: float = 2,
    embed_images: bool = True,
    title: str = "Converted document",
    component_name: str = "PdfDocument",
    max_pages: int = 0,
    on_progress: Callable[[int, int, str], None] | None = None,
    is_cancelled: Callable[[], bool] | None = None,
) -> ConversionResult:
    """Convert a PDF into the requested formats, writing the result into `out_dir`."""
    path = Path(path)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    formats = formats or ["html"]

    def cancelled() -> None:
        if is_cancelled and is_cancelled():
            raise ConversionError("Conversion cancelled", "CANCELLED")

    def progress(page: int, pages: int, phase: str) -> None:
        if on_progress:
            on_progress(page, pages, phase)

    info = inspect(path)
    page_count = min(info.pages, max_pages) if max_pages > 0 else info.pages

    document = pdfium.PdfDocument(str(path)) if background else None
    pages: list[PageModel] = []
    backgrounds: list[str | None] = []
    written: list[str] = []

    try:
        for number in range(1, page_count + 1):
            cancelled()
            progress(number, page_count, "extract")

            model = extract_page(path, number)
            pages.append(model)

            # Rasterise only where it earns its bytes: a page that is pure text
            # reconstructs perfectly as markup, and a background image there is dead
            # weight.
            hint = classify_page(model)
            worth_rastering = hint.kind != "text" or not model.runs

            if background and document is not None and worth_rastering:
                progress(number, page_count, "render")
                try:
                    payload = render_page(document, number, background_scale, hint)
                    if embed_images:
                        backgrounds.append(as_data_uri(payload, hint))
                    else:
                        name = write_page_image(payload, hint, out_dir, number)
                        written.append(name)
                        backgrounds.append(name)
                except Exception:
                    # A failed raster degrades that page to text-only rather than
                    # killing the job.
                    backgrounds.append(None)
            else:
                backgrounds.append(None)
    finally:
        if document is not None:
            document.close()

    cancelled()
    progress(page_count, page_count, "generate")

    if "html" in formats:
        (out_dir / "index.html").write_text(
            to_html(
                pages,
                title=info.title or title,
                backgrounds=backgrounds,
                lang=info.lang,
                dir=info.dir,
            ),
            encoding="utf-8",
        )
        written.append("index.html")

    if "react" in formats:
        for name, contents in to_react(
            pages,
            backgrounds=backgrounds,
            component_name=component_name,
            lang=info.lang,
            dir=info.dir,
        ).items():
            (out_dir / name).write_text(contents, encoding="utf-8")
            written.append(name)

    return ConversionResult(
        info=info,
        converted=page_count,
        pages=pages,
        files=written,
        warnings=_warnings(info, pages, backgrounds, background, max_pages),
    )


def _warnings(
    info: DocumentInfo,
    pages: list[PageModel],
    backgrounds: list[str | None],
    background: bool,
    max_pages: int,
) -> list[ConversionWarning]:
    warnings: list[ConversionWarning] = []

    if info.scanned:
        warnings.append(
            ConversionWarning(
                code="SCANNED",
                message=(
                    "This PDF has no text layer — it is a scan. The output keeps the "
                    "page images, but the text will not be selectable or searchable "
                    "without OCR."
                ),
            )
        )

    dropped = sum(
        1
        for i, page in enumerate(pages)
        if not backgrounds[i] and (page.stats.vector > 4 or page.stats.images > 0)
    )
    if dropped and not background:
        warnings.append(
            ConversionWarning(
                code="GRAPHICS_DROPPED",
                params={"count": dropped},
                message=(
                    f"{dropped} page{'' if dropped == 1 else 's'} contain graphics that "
                    'text-only output cannot reproduce. Turn on "Keep graphics" to keep them.'
                ),
            )
        )

    if max_pages and info.pages > max_pages:
        warnings.append(
            ConversionWarning(
                code="TRUNCATED",
                params={"limit": max_pages, "total": info.pages},
                message=f"Only the first {max_pages} of {info.pages} pages were converted.",
            )
        )

    return warnings
