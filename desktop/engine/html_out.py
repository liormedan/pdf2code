"""Page model -> standalone HTML.

Named html_out rather than html: a module called html.py in this directory shadows the
standard library module of the same name for every package in the process, pdfminer
included. That is a spectacularly confusing failure and it costs one underscore to
avoid.

A translation of src/converter/html.ts. Each page is two stacked layers — a raster
carrying every vector path, image and rule, and real positioned markup carrying the
text. Text stays selectable, searchable, translatable and editable; visuals stay exact.

**The escaping is the first thing in this file for a reason.** Every string that reaches
the output came out of a document nobody vetted, and `09-hostile-text.pdf` exists in the
fixture set precisely because someone will eventually convert a PDF containing
`<script>`. `escape()` covers `&`, `<`, `>` and `"`, and it is applied to the style
attribute as well as to the text — font families are quoted, and one unescaped quote
there ends the attribute and hands the rest of the run to the parser as markup.

The QA suite's injection checks are the acceptance test for this, and they are run
against this implementation rather than assumed to carry over.
"""

from __future__ import annotations

from model import Direction, FontDescription, PageModel

_ESCAPE = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}


def escape(value: object) -> str:
    """Escape for both text content and attribute values.

    Ampersand is replaced first by virtue of the table being applied per character —
    doing it in passes, with `&` last, would double-escape everything the earlier
    passes produced.
    """
    return "".join(_ESCAPE.get(char, char) for char in str(value))


def page_to_html(page: PageModel, background: str | None = None, indent: str = "  ") -> str:
    """One page as a positioned block. `background` is an optional data: URI."""
    lines: list[str] = []
    pad = indent * 2

    lines.append(
        f'{indent}<section class="pdf-page" '
        f'style="width:{page.width}px;height:{page.height}px" data-page="{page.number}">'
    )

    if background:
        # Integers, not the page's own floating-point size. HTML's `width` and `height`
        # attributes are defined as non-negative integers, and a validator rejects
        # width="960.0" outright. The CSS sizes this image to fill the page anyway, so
        # the attributes serve only as an aspect-ratio hint and rounding costs nothing.
        #
        # The TypeScript has the same defect and has never been caught by it: there is
        # no rasteriser in Node, so `npm run validate` converts without backgrounds and
        # this element is never emitted for it to check. Recorded in the backlog.
        lines.append(
            f'{pad}<img class="pdf-bg" src="{background}" alt="" '
            f'width="{round(page.width)}" height="{round(page.height)}">'
        )

    for run in page.runs:
        # A run can name a font the table never described; the stack degrades to the
        # browser default rather than the generator failing.
        font: FontDescription | None = page.fonts.get(run.font)
        parts = [
            f"left:{run.x}px",
            f"top:{run.y}px",
            f"font-size:{run.size}px",
        ]
        if font and font.family:
            parts.append(f"font-family:{font.family}")
        if font and font.weight and font.weight != 400:
            parts.append(f"font-weight:{font.weight}")
        if font and font.style == "italic":
            parts.append("font-style:italic")
        if run.angle:
            parts.append(f"transform:rotate({run.angle}rad)")
        style = ";".join(parts)

        # Per-run direction is what keeps Hebrew and Arabic readable without us
        # reordering anything at render time — the browser resolves bidi from here.
        run_dir = ' dir="rtl"' if run.rtl else ""
        lines.append(f'{pad}<span style="{escape(style)}"{run_dir}>{escape(run.text)}</span>')

    lines.append(f"{indent}</section>")
    return "\n".join(lines)


PAGE_CSS = """.pdf-doc {
  --page-gap: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--page-gap);
  margin: 0;
  padding: var(--page-gap);
  background: #525659;
}
.pdf-page {
  position: relative;
  flex: none;
  background: #fff;
  overflow: hidden;
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.35);
  transform-origin: 0 0;
}
.pdf-page > span {
  position: absolute;
  white-space: pre;
  transform-origin: 0 0;
  line-height: 1;
  color: #000;
}
.pdf-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  user-select: none;
  pointer-events: none;
}
/* The raster already shows the glyphs; the text layer sits on top only so it can be
   selected, searched and read by assistive tech. Without a background it must show. */
.pdf-doc[data-background="true"] .pdf-page > span {
  color: transparent;
}
.pdf-doc[data-background="true"] .pdf-page > span::selection {
  background: rgb(0 102 204 / 0.35);
}
@media print {
  .pdf-doc { background: none; padding: 0; gap: 0; }
  .pdf-page { box-shadow: none; page-break-after: always; }
}"""

# Pages are laid out at their true pixel size; on narrow screens the whole stack scales
# down rather than reflowing, because reflowing a fixed layout destroys it.
_RESPONSIVE_SCRIPT = """
<script>
(function () {
  var doc = document.querySelector('.pdf-doc');
  if (!doc) return;
  function fit() {
    var pad = 48;
    var natural = Math.max.apply(null, [].map.call(
      doc.querySelectorAll('.pdf-page'), function (p) { return p.offsetWidth; }));
    if (!natural) return;
    var scale = Math.min(1, (doc.clientWidth - pad) / natural);
    [].forEach.call(doc.querySelectorAll('.pdf-page'), function (p) {
      p.style.transform = scale < 1 ? 'scale(' + scale + ')' : '';
      p.style.marginBottom = scale < 1 ? (p.offsetHeight * (scale - 1)) + 'px' : '';
      p.style.marginRight = scale < 1 ? (p.offsetWidth * (scale - 1)) + 'px' : '';
    });
  }
  addEventListener('resize', fit);
  fit();
})();
</script>"""

_BARE_CSS = """
/* Chrome removed: the page is the whole viewport. */
.pdf-doc { padding: 0; gap: 0; background: none; }
.pdf-page { box-shadow: none; }"""


def to_html(
    pages: list[PageModel],
    *,
    title: str = "Converted document",
    backgrounds: list[str | None] | None = None,
    responsive: bool = True,
    lang: str = "en",
    dir: Direction = "ltr",
    bare: bool = False,
) -> str:
    """Full standalone document.

    `bare` drops the viewer chrome — the dark surround, the page gap and the shadow —
    and lets a single page fill the viewport exactly. The default styling exists for
    someone opening the file directly, where a page floating on a grey ground reads as
    a document; rendered into a frame already sized to the page, that ground becomes a
    grey band and shifts the content out of alignment with whatever it is being
    compared against.
    """
    backgrounds = backgrounds or []
    has_bg = any(backgrounds)

    body = "\n".join(
        page_to_html(page, backgrounds[i] if i < len(backgrounds) else None)
        for i, page in enumerate(pages)
    )

    script = _RESPONSIVE_SCRIPT if responsive else ""
    bare_css = _BARE_CSS if bare else ""

    return f"""<!DOCTYPE html>
<html lang="{escape(lang)}" dir="{escape(dir)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(title)}</title>
<style>
html, body {{ margin: 0; padding: 0; }}
{PAGE_CSS}{bare_css}
</style>
</head>
<body>
<main class="pdf-doc" data-background="{'true' if has_bg else 'false'}">
{body}
</main>{script}
</body>
</html>
"""
