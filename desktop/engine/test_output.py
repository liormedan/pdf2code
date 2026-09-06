"""Does the output we hand people survive a document written to attack it?

    .venv/Scripts/python.exe test_output.py

These are the injection checks from scripts/qa.mjs, run against this engine rather than
assumed to have carried over with the translation. `09-hostile-text.pdf` exists in the
fixture set for exactly this: it contains `<script>`, `onerror=`, `javascript:` URLs and
text that is already an HTML entity, and it is the document that decides whether
`escape()` and `js_string()` were ported correctly.

A rewritten generator that is *almost* right here produces output that looks perfect on
every ordinary document and turns the one hostile one into a page that runs somebody
else's code. That is why this is the first acceptance test of sprint 4 and not the last.

HTML5 validation and JSX compilation need the repository's Node toolchain, so they live
in parity/validate_output.mjs and run alongside these.
"""

from __future__ import annotations

import re
import shutil
import sys
import tempfile
from pathlib import Path

from convert import classify_page, convert

HERE = Path(__file__).parent
FIXTURES = HERE.parent.parent / "fixtures"

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {name}{f'  — {detail}' if detail else ''}")
    if not ok:
        FAILURES.append(name)


def check_injection(out_dir: Path) -> None:
    print("\n  Injection — hostile PDF text must not become executable markup")

    result = convert(
        FIXTURES / "09-hostile-text.pdf",
        out_dir,
        formats=["html", "react"],
        background=False,
        title="hostile",
        component_name="Hostile",
    )

    html = (out_dir / "index.html").read_text(encoding="utf-8")
    jsx = (out_dir / "Hostile.jsx").read_text(encoding="utf-8")

    # The generated page has exactly one script — the responsive fitter we author.
    scripts = re.findall(r"<script\b[^>]*>", html, re.I)
    check("no injected <script> in HTML", len(scripts) == 1, f"{len(scripts)} script tags")

    # Inspect the *tags*, not the whole document. Hostile text survives as escaped
    # content — "&lt;img src=x onerror=…" — so a search over the raw string matches
    # harmless text and proves nothing. Since "<" is always escaped in text, this
    # pattern reliably isolates real markup.
    tags = re.findall(r"<[a-z!/][^>]*>", html, re.I)

    with_handler = [t for t in tags if re.search(r"\son[a-z]+\s*=", t, re.I)]
    check("no inline event handlers on any tag", not with_handler, (with_handler or [""])[0][:60])

    with_js_url = [
        t for t in tags if re.search(r"""(?:href|src|action)\s*=\s*["']?\s*javascript:""", t, re.I)
    ]
    check("no javascript: URLs in attributes", not with_js_url, (with_js_url or [""])[0][:60])

    hostile_tag = next((t for t in tags if "onerror" in t), None)
    check("hostile text never became a tag", hostile_tag is None, (hostile_tag or "")[:60])

    # The dangerous strings must survive as visible text, escaped.
    check("script text preserved but escaped", "&lt;script&gt;" in html)

    # Text that was *already* an entity in the PDF. The document literally contains the
    # characters "&lt;already escaped&gt;", and the reader must see those characters —
    # which means the ampersand is escaped exactly once and "&amp;lt;" is the correct
    # thing to find in the source. Escaping zero times would render it as a tag;
    # escaping twice would show the reader "&amp;lt;".
    model_text = "".join(run.text for page in result.pages for run in page.runs)
    check("pre-existing entity text survives extraction", "&lt;already escaped&gt;" in model_text)
    check("pre-existing entities are escaped exactly once", "&amp;lt;already escaped&amp;gt;" in html)
    check("nothing is escaped twice", "&amp;amp;lt;" not in html)

    # React: text goes in an expression container, so it can never be parsed as markup.
    # Verified structurally — with string literals neutralised first, because the
    # hostile text literally contains "<span>" and would otherwise match itself.
    skeleton = re.sub(r'"(?:[^"\\]|\\.)*"', '"S"', jsx)
    span_children = re.findall(r"<span[^>]*>(.)", skeleton)
    raw = [c for c in span_children if c != "{"]
    check(
        "every JSX span holds text in an expression container",
        bool(span_children) and not raw,
        f"{len(raw)} of {len(span_children)} spans hold raw text",
    )

    # The hostile lines have to have reached the model at all — a generator that is
    # safe because extraction dropped the text proves nothing.
    text = "".join(run.text for page in result.pages for run in page.runs)
    for needle in ("<script>", "onerror", "javascript:"):
        check(f"hostile text reached the model: {needle}", needle in text)


def check_rasters(out_dir: Path) -> None:
    """The format decision, which is about fidelity rather than bytes.

    Line art must be PNG. JPEG rings around glyph and vector edges, and on output that
    promises an exact copy of a document, ringing around every letter is the failure the
    whole product is built to avoid.
    """
    print("\n  Raster — the format follows what paints the page")

    expected = {
        "08-hebrew-doc.pdf": "lineArt",
        "07-academic-tables.pdf": "lineArt",
        "09-hostile-text.pdf": "text",
        "04-scanned-ccitt.pdf": "photographic",
    }

    for name, kind in expected.items():
        result = convert(FIXTURES / name, out_dir / name, max_pages=1, background=True)
        hint = classify_page(result.pages[0])
        check(f"{name} classified {kind}", hint.kind == kind, f"got {hint.kind}")
        if hint.kind == "lineArt":
            check(f"{name} line art is PNG, not JPEG", hint.format == "png", hint.format)

        html = (result_dir := out_dir / name) and (result_dir / "index.html").read_text("utf-8")
        if kind == "text":
            check(f"{name} pure text carries no raster", "data:image" not in html)
        else:
            check(f"{name} carries its raster", "data:image" in html)


def check_document_shape(out_dir: Path) -> None:
    """The declarations a converted document has to get right to be readable."""
    print("\n  Document — language and direction come from the document itself")

    result = convert(FIXTURES / "08-hebrew-doc.pdf", out_dir, max_pages=1, formats=["html", "react"])
    html = (out_dir / "index.html").read_text(encoding="utf-8")

    check("Hebrew declares lang=he", 'lang="he"' in html)
    check("Hebrew declares dir=rtl", 'dir="rtl"' in html)
    check("right-to-left runs are marked", 'dir="rtl">' in html)
    check("the document reports RTL", result.info.has_rtl)

    jsx = (out_dir / "PdfDocument.jsx").read_text(encoding="utf-8")
    check("React output declares the same language", 'lang="he"' in jsx and 'dir="rtl"' in jsx)


def main() -> int:
    if not FIXTURES.exists():
        print(f"missing fixtures at {FIXTURES}")
        return 1

    print("output validation")
    workspace = Path(tempfile.mkdtemp(prefix="pdf2code-qa-"))
    try:
        check_injection(workspace / "hostile")
        check_rasters(workspace / "raster")
        check_document_shape(workspace / "hebrew")
    finally:
        shutil.rmtree(workspace, ignore_errors=True)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} failed: {', '.join(FAILURES[:3])}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
