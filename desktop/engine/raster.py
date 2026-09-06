"""The raster layer.

In the web app this step needed a browser canvas, so `convert()` took a `rasterize`
callback and the Node test suites simply passed nothing and got text-only output. Here
there is no canvas and no need for one: PDFium renders directly, which is also what
Chrome does, so the raster looks like what the user saw when they opened the file.

The format is not a preference. `classify_page` decides it from what actually paints
the page, and the reasoning is worth keeping in front of whoever changes it: **line art
must be PNG.** JPEG rings around glyph and vector edges, and on output that promises an
exact copy of a document, ringing around every letter is the whole failure. Only
genuinely photographic pages take JPEG, where PNG would be several times larger for no
visible gain.
"""

from __future__ import annotations

import base64
import io
from pathlib import Path

import pypdfium2 as pdfium

from model import RasterHint


def render_page(
    document: pdfium.PdfDocument,
    number: int,
    scale: float,
    hint: RasterHint,
) -> bytes:
    """Render one page (1-based) and encode it according to the hint."""
    page = document[number - 1]
    bitmap = page.render(scale=scale)
    image = bitmap.to_pil()

    buffer = io.BytesIO()
    if hint.format == "jpeg":
        # JPEG has no alpha, and PDFium hands back RGBA when the page has transparency.
        if image.mode != "RGB":
            image = image.convert("RGB")
        image.save(buffer, format="JPEG", quality=int(hint.quality * 100), optimize=True)
    else:
        image.save(buffer, format="PNG", optimize=True)

    return buffer.getvalue()


def as_data_uri(payload: bytes, hint: RasterHint) -> str:
    """A data: URI, which is what keeps the exported HTML a single standalone file."""
    mime = "image/jpeg" if hint.format == "jpeg" else "image/png"
    return f"data:{mime};base64,{base64.b64encode(payload).decode('ascii')}"


def write_page_image(
    payload: bytes, hint: RasterHint, out_dir: Path, number: int
) -> str:
    """Write the raster beside the output and return its relative name.

    The alternative — a data: URI — keeps the HTML standalone but triples the size of
    every image and puts the whole document in one file. Both are offered because they
    answer different needs: one file to send someone, or a folder to check into a
    project.
    """
    suffix = "jpg" if hint.format == "jpeg" else "png"
    name = f"page-{number}.{suffix}"
    (out_dir / name).write_bytes(payload)
    return name
