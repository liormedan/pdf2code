"""What the engine can be asked to do.

Two operations in this sprint, and neither converts anything. That is the point: the
contract, the threading, the progress and the cancellation are the risky parts, and
they are worth getting right against work that cannot fail for its own reasons. The
converter arrives in sprint 3 behind exactly this interface — `convert` becomes one
more entry in OPS, and nothing above it changes.

Every operation takes (args, ctx) and returns the payload of a `result`. To report
progress it calls `ctx.progress(...)`; to be cancellable it checks `ctx.cancelled`
often enough that a person clicking Cancel sees it stop.
"""

from __future__ import annotations

import functools
import threading
import time
from typing import Any, Callable, Protocol


class Cancelled(Exception):
    """Raised by a checkpoint when the job has been asked to stop.

    An exception rather than a return value, so that a deeply nested loop cannot
    forget to propagate it — which is exactly how cancellation quietly stops working.
    """


class Context(Protocol):
    """What an operation may do to the outside world. Nothing else."""

    @property
    def cancelled(self) -> bool: ...

    def progress(self, *, page: int, pages: int, phase: str) -> None: ...

    def checkpoint(self) -> None:
        """Raise Cancelled if a cancel has arrived."""


# One turn at a time with PDFium, for every operation that touches it.
#
# PDFium is not thread-safe, and every job here runs on its own thread. Two documents
# open at once — even two handles on the same file — race inside the library, and the
# loser is told "Data format error" about a file that is perfectly well formed. Found
# the first time the workbench asked for a document's pages all at once: of 35 renders,
# one succeeded.
#
# The lock lives here and not in the callers because no caller can know what else is
# in flight. Re-entrant, because `convert` calls `extract` calls the rasteriser, all on
# the one thread that holds it.
PDFIUM = threading.RLock()


def serialised(handler: Callable[[dict[str, Any], Context], dict[str, Any]]):
    """Run the handler holding the PDFium lock.

    Polled rather than blocked on, so that a job cancelled while it waits its turn stops
    then — and not after doing, at length, the very work it was told to abandon.
    """

    @functools.wraps(handler)
    def wrapped(args: dict[str, Any], ctx: Context) -> dict[str, Any]:
        while not PDFIUM.acquire(timeout=0.05):
            ctx.checkpoint()
        try:
            return handler(args, ctx)
        finally:
            PDFIUM.release()

    return wrapped


def op_echo(args: dict[str, Any], ctx: Context) -> dict[str, Any]:
    """Return what you were given.

    The smallest possible proof that the whole chain is intact: React invoked Rust,
    Rust framed a line, Python parsed it, and the answer came back matched to its id.
    """
    return {"echo": args.get("value")}


def op_sleep(args: dict[str, Any], ctx: Context) -> dict[str, Any]:
    """Do nothing, slowly, in steps — a stand-in for a real conversion.

    It exists to exercise the two things that are genuinely hard to get right and
    trivial to fake: progress that arrives *during* the work rather than after it, and
    a cancel that lands while a worker thread is busy.
    """
    steps = max(1, min(int(args.get("steps", 10)), 1000))
    every = max(0.0, float(args.get("seconds", 0.1)))
    phase = args.get("phase", "extract")

    for step in range(1, steps + 1):
        # Checked before the sleep as well as after, so a cancel that arrives during
        # the very first step is still honoured.
        ctx.checkpoint()
        time.sleep(every)
        ctx.progress(page=step, pages=steps, phase=phase)

    return {"slept": steps * every, "steps": steps}


@serialised
def op_probe(args: dict[str, Any], ctx: Context) -> dict[str, Any]:
    """Open a document and report what is in it, without converting anything.

    Two jobs, and the second is the reason this exists so early.

    The product one: the interface needs a page count and a "does this even open"
    answer before it offers to convert, and it needs both without paying for a
    conversion.

    The packaging one: `echo` and `sleep` are pure Python, so a frozen build passes
    every contract check even when PDFium's native library was left out of the bundle
    and pdfminer's CMap data went missing. Those are the two failures that only appear
    in an installed app, and this is the operation that makes them appear in a test
    instead. It is deliberately the first thing run against a freshly frozen binary.
    """
    # Imported here, not at module load: the sidecar should announce itself and answer
    # `echo` even if something is wrong with the PDF stack, so that the failure is
    # reportable rather than a process that dies before it can say anything.
    import pypdfium2 as pdfium
    from pdfminer.high_level import extract_pages
    from pdfminer.layout import LTChar, LTTextContainer

    path = args.get("path")
    if not isinstance(path, str) or not path:
        raise ValueError("probe needs a path")

    ctx.checkpoint()

    document = pdfium.PdfDocument(path)
    pages = len(document)

    ctx.progress(page=1, pages=2, phase="extract")
    ctx.checkpoint()

    # One page is enough to prove the text stack works, and keeps this cheap on a
    # document with hundreds.
    chars = 0
    rtl = 0
    fonts: set[str] = set()
    for layout in extract_pages(path, maxpages=1):
        for element in layout:
            if not isinstance(element, LTTextContainer):
                continue
            for line in element:
                for char in getattr(line, "_objs", []):
                    if not isinstance(char, LTChar):
                        continue
                    chars += 1
                    fonts.add(char.fontname)
                    if "֐" <= char.get_text() <= "׿":
                        rtl += 1

    ctx.progress(page=2, pages=2, phase="extract")

    return {
        "pages": pages,
        "chars": chars,
        "rtl": rtl,
        # Sorted so the answer is stable enough to assert on.
        "fonts": sorted(fonts),
        # No text layer on the sampled page: the same signal DocumentInfo.scanned
        # carries in src/converter/types.ts.
        "scanned": chars == 0,
    }


@serialised
def op_convert(args: dict[str, Any], ctx: Context) -> dict[str, Any]:
    """Convert a document, writing the result to disk and reporting where.

    The result carries **names, not contents**. A hundred and fifty rasterised pages as
    base64 would be tens of megabytes of JSON through a pipe meant for control — see
    desktop/architecture.md §2. The window is told the directory and reads from it.

    `warnings` keeps the shape the interface already knows: a code and its parameters,
    never a sentence. The engine does not know what language the reader speaks.
    """
    from convert import ConversionError, convert  # noqa: PLC0415 — see op_probe

    path = args.get("path")
    out = args.get("out")
    if not isinstance(path, str) or not path:
        raise ValueError("convert needs a path")
    if not isinstance(out, str) or not out:
        raise ValueError("convert needs an output directory")

    formats = args.get("formats") or ["html"]
    if not isinstance(formats, list) or not all(f in ("html", "react") for f in formats):
        raise ValueError("formats must be a list of 'html' and/or 'react'")

    def progress(page: int, pages: int, phase: str) -> None:
        ctx.progress(page=page, pages=pages, phase=phase)

    try:
        result = convert(
            path,
            out,
            formats=formats,
            background=bool(args.get("background", True)),
            background_scale=float(args.get("backgroundScale", 2)),
            embed_images=bool(args.get("embedImages", True)),
            title=str(args.get("title", "Converted document")),
            component_name=str(args.get("componentName", "PdfDocument")),
            max_pages=int(args.get("maxPages", 0)),
            on_progress=progress,
            is_cancelled=lambda: ctx.cancelled,
        )
    except ConversionError as error:
        if error.code == "CANCELLED":
            raise Cancelled() from error
        raise

    info = result.info
    return {
        "out": out,
        "files": result.files,
        "info": {
            "pages": info.pages,
            "converted": result.converted,
            "title": info.title,
            "producer": info.producer,
            "scanned": info.scanned,
            "hasRTL": info.has_rtl,
            "lang": info.lang,
            "dir": info.dir,
        },
        "warnings": [
            {"code": w.code, "params": w.params, "message": w.message} for w in result.warnings
        ],
    }


@serialised
def op_edit(args: dict[str, Any], ctx: Context) -> dict[str, Any]:
    """Rotate, reorder, delete, extract, split or merge — all of them, from one plan.

    See pages.py: a plan is a list saying which page of which file goes where and how it
    is turned, and every one of those six features is a shape that list can take.
    """
    from pages import apply_plan, parse_plan  # noqa: PLC0415 — see op_probe

    plan = args.get("plan")
    out = args.get("out")
    if not isinstance(plan, list):
        raise ValueError("edit needs a plan")
    if not isinstance(out, str) or not out:
        raise ValueError("edit needs an output path")

    ctx.checkpoint()
    parsed = parse_plan(plan)
    ctx.progress(page=1, pages=2, phase="generate")
    result = apply_plan(parsed, out, overwrite=bool(args.get("overwrite", False)))
    ctx.progress(page=2, pages=2, phase="generate")
    return result


@serialised
def op_thumbnails(args: dict[str, Any], ctx: Context) -> dict[str, Any]:
    """Small page images, for a page view. Written to disk; paths come back."""
    from pages import thumbnails  # noqa: PLC0415

    path = args.get("path")
    out = args.get("out")
    if not isinstance(path, str) or not isinstance(out, str):
        raise ValueError("thumbnails needs a path and an output directory")

    def progress(page: int, pages: int) -> None:
        ctx.checkpoint()
        ctx.progress(page=page, pages=pages, phase="render")

    ctx.checkpoint()
    made = thumbnails(
        path,
        out,
        width=int(args.get("width", 180)),
        pages=args.get("pages"),
        on_page=progress,
    )
    return {"thumbnails": made}


@serialised
def op_export_images(args: dict[str, Any], ctx: Context) -> dict[str, Any]:
    """Export the plan as images.

    Takes the same `plan` shape as `edit`, and deliberately: these two are the only ways
    a workbench turns into files, and they should not disagree about what the workbench
    says. When this took a source and a sorted list of page numbers, it did disagree —
    see `pages.export_images`.
    """
    from pages import export_images, parse_plan  # noqa: PLC0415

    out = args.get("out")
    entries = args.get("plan")
    if not isinstance(out, str) or not isinstance(entries, list):
        raise ValueError("export needs a plan and an output directory")

    # Reported per page: exporting five hundred pages at scale 2 takes long enough that a
    # still window reads as a hang, exactly as in `thumbnails`.
    def progress(page: int, pages: int) -> None:
        ctx.checkpoint()
        ctx.progress(page=page, pages=pages, phase="render")

    ctx.checkpoint()
    made = export_images(
        parse_plan(entries),
        out,
        scale=float(args.get("scale", 2.0)),
        format=str(args.get("format", "png")),
        on_page=progress,
    )
    return {"images": made}


@serialised
def op_compress(args: dict[str, Any], ctx: Context) -> dict[str, Any]:
    """Compress the plan — the same list `edit` and `exportImages` take.

    A plan and not a path, for the reason the other two take one: the window used to
    build the plan into a staged file itself and hand that file here, and everything
    this op could check was then about the staged copy — the size it compared against,
    the source it refused to overwrite. Neither was the document somebody had. Taking
    the plan puts the sources in front of the one place that has to know them.

    `scratch` is where the staged copy goes; the Rust side gates it like `out`.
    """
    from pages import compress_plan, parse_plan  # noqa: PLC0415

    plan = args.get("plan")
    out = args.get("out")
    scratch = args.get("scratch")
    if not isinstance(plan, list) or not plan:
        raise ValueError("compress needs a non-empty plan")
    if not isinstance(out, str) or not out:
        raise ValueError("compress needs an output path")
    if not isinstance(scratch, str) or not scratch:
        raise ValueError("compress needs a scratch directory")

    ctx.checkpoint()
    parsed = parse_plan(plan)
    ctx.progress(page=1, pages=2, phase="generate")
    result = compress_plan(parsed, out, scratch)
    ctx.progress(page=2, pages=2, phase="generate")
    return result


@serialised
def op_page_text(args: dict[str, Any], ctx: Context) -> dict[str, Any]:
    """The text of some pages, in reading order.

    This is what search and copy are built on, and it goes through the same extraction
    the converter uses — which means the Hebrew comes back the right way round. Copying
    text out of a Hebrew PDF and getting it reversed is situation 5 in
    business/situations.md; getting it right here is the same win in a smaller place.
    """
    from extract import extract_document  # noqa: PLC0415

    path = args.get("path")
    if not isinstance(path, str) or not path:
        raise ValueError("text needs a path")

    numbers = args.get("pages")
    if not isinstance(numbers, list) or not numbers:
        raise ValueError("text needs a list of page numbers")

    # One walk, stopping at the last page asked for, rather than one walk per page.
    # Asking pdfminer for page N makes it parse the N-1 before it, so the loop this used
    # to be cost 218 ms/page on a five-hundred-page document against 22 for the converter
    # doing strictly more work. Search over a long document is the thing that felt it.
    wanted = {int(n) for n in numbers}
    ctx.checkpoint()
    models = {
        model.number: model
        for model in extract_document(path, max_pages=max(wanted))
        if model.number in wanted
    }

    out: list[dict[str, Any]] = []
    total = len(numbers)
    for index, number in enumerate(numbers, start=1):
        ctx.checkpoint()
        model = models.get(int(number))
        if model is None:
            continue
        # Lines rather than runs: a run is a rendering detail, and nobody searches for
        # half a sentence because the font changed in the middle of it.
        lines: dict[float, list[str]] = {}
        for run in model.runs:
            lines.setdefault(round(run.y, 1), []).append(run.text)
        out.append(
            {
                "page": int(number),
                "lines": ["".join(parts) for _, parts in sorted(lines.items())],
                "rtl": any(run.rtl for run in model.runs),
            }
        )
        ctx.progress(page=index, pages=total, phase="extract")

    return {"pages": out}


def op_zip(args: dict[str, Any], ctx: Context) -> dict[str, Any]:
    """Pack a conversion's folder into one file somebody can send.

    The engine does this rather than Rust because the engine already knows what it
    wrote, and `zipfile` is in the standard library it already ships.
    """
    from archive import zip_dir  # noqa: PLC0415 - see op_probe

    path = args.get("path")
    out = args.get("out")
    if not isinstance(path, str) or not path:
        raise ValueError("zip needs a folder")
    if not isinstance(out, str) or not out:
        raise ValueError("zip needs an output path")

    ctx.checkpoint()
    ctx.progress(page=1, pages=2, phase="generate")
    result = zip_dir(path, out, overwrite=bool(args.get("overwrite", False)))
    ctx.progress(page=2, pages=2, phase="generate")
    return result


OPS: dict[str, Callable[[dict[str, Any], Context], dict[str, Any]]] = {
    "echo": op_echo,
    "sleep": op_sleep,
    "probe": op_probe,
    "convert": op_convert,
    "edit": op_edit,
    "thumbnails": op_thumbnails,
    "exportImages": op_export_images,
    "compress": op_compress,
    "text": op_page_text,
    "zip": op_zip,
}
