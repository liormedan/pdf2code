"""Page model -> React component.

A translation of src/converter/react.ts. Not an HTML-to-JSX rewrite: generating straight
from the model avoids that whole class of bugs — unclosed tags, class versus className,
style strings, entity handling — and lets the output be shaped like code a developer
would actually keep.

**Every value that came out of the document goes through `js_string`**, which is
`JSON.stringify` in the TypeScript and `json.dumps` here. Text lands inside a JSX
expression container rather than as element content, so no character needs JSX escaping
and there is no path by which document text becomes markup. That is the same guarantee
`escape()` gives on the HTML side, reached a different way.
"""

from __future__ import annotations

import json
import re

from html_out import PAGE_CSS
from model import Direction, FontDescription, PageModel, TextRun

_SAFE_COMPONENT = re.compile(r"^[A-Z][A-Za-z0-9]*$")


def js_string(value: object) -> str:
    """A JavaScript string literal. `json.dumps` and `JSON.stringify` agree here."""
    return json.dumps(str(value), ensure_ascii=False)


def _style_literal(run: TextRun, font: FontDescription | None) -> str:
    """Style object literal, so React gets real props rather than a parsed string."""
    parts = [f"left: {run.x}", f"top: {run.y}", f"fontSize: {run.size}"]
    if font and font.family:
        parts.append(f"fontFamily: {js_string(font.family)}")
    if font and font.weight and font.weight != 400:
        parts.append(f"fontWeight: {font.weight}")
    if font and font.style == "italic":
        parts.append('fontStyle: "italic"')
    if run.angle:
        parts.append(f"transform: {js_string(f'rotate({run.angle}rad)')}")
    return "{ " + ", ".join(parts) + " }"


def _page_component(page: PageModel, background: str | None, indent: str = "  ") -> str:
    pad = indent * 3
    lines: list[str] = []

    lines.append(f"{indent}<section")
    lines.append(f'{indent}  className="pdf-page"')
    lines.append(f"{indent}  data-page={{{page.number}}}")
    lines.append(f"{indent}  style={{{{ width: {page.width}, height: {page.height} }}}}")
    lines.append(f"{indent}>")

    if background:
        lines.append(
            f'{indent}  <img className="pdf-bg" src={{{js_string(background)}}} alt="" '
            f"width={{{page.width}}} height={{{page.height}}} />"
        )

    for run in page.runs:
        font = page.fonts.get(run.font)
        run_dir = ' dir="rtl"' if run.rtl else ""
        # Text goes in an expression container so no character needs JSX escaping.
        lines.append(
            f"{pad}<span style={{{_style_literal(run, font)}}}{run_dir}>"
            f"{{{js_string(run.text)}}}</span>"
        )

    lines.append(f"{indent}</section>")
    return "\n".join(lines)


def to_react(
    pages: list[PageModel],
    *,
    backgrounds: list[str | None] | None = None,
    component_name: str = "PdfDocument",
    lang: str = "en",
    dir: Direction = "ltr",
) -> dict[str, str]:
    """Returns filename -> contents."""
    backgrounds = backgrounds or []
    # A component name is written into an import path and an identifier. Anything that
    # is not a plain PascalCase word is replaced rather than escaped, because there is
    # no escaping that makes an arbitrary string a valid identifier.
    safe_name = component_name if _SAFE_COMPONENT.match(component_name) else "PdfDocument"
    has_bg = any(backgrounds)

    # Each page is its own component so consumers can render, lazy-load or reorder pages
    # individually instead of being handed one unmanageable blob.
    page_components = "\n".join(
        f"""
function Page{page.number}() {{
  return (
{_page_component(page, backgrounds[i] if i < len(backgrounds) else None)}
  );
}}"""
        for i, page in enumerate(pages)
    )

    page_list = ", ".join(f"Page{page.number}" for page in pages)
    has_bg_js = "true" if has_bg else "false"

    component = f"""// Generated from a PDF. Layout is absolutely positioned to match the original,
// so page dimensions are fixed rather than fluid.
import "./{safe_name}.css";
{page_components}

const PAGES = [{page_list}];

/**
 * @param {{object}} props
 * @param {{number}} [props.scale]  1 = original size
 * @param {{string}} [props.className]
 */
export default function {safe_name}({{ scale = 1, className = "" }}) {{
  return (
    <main
      className={{`pdf-doc ${{className}}`}}
      data-background={{{has_bg_js}}}
      lang="{lang}"
      dir="{dir}"
      style={{scale === 1 ? undefined : {{ transform: `scale(${{scale}})`, transformOrigin: "0 0" }}}}
    >
      {{PAGES.map((Page, i) => (
        <Page key={{i}} />
      ))}}
    </main>
  );
}}
"""

    graphics_note = (
        "Non-text content (vector art, images, rules) is baked into a background image "
        "per page, with the real text placed transparently on top — so the page looks "
        "identical to the PDF while the text stays selectable, searchable and "
        "translatable."
        if has_bg
        else "Output is text-only: no background images, so the markup is clean and easy "
        "to restyle, but any vector art or images from the original are not present."
    )

    readme = f"""# {safe_name}

Generated from a PDF.

## Use

```jsx
import {safe_name} from "./{safe_name}";

export default function App() {{
  return <{safe_name} scale={{1}} />;
}}
```

## How it is built

Every page is a separate component with absolutely positioned text runs, matching the
original layout exactly. {graphics_note}

## Props

| prop | type | default | meaning |
| --- | --- | --- | --- |
| `scale` | number | `1` | `1` is the PDF's original size |
| `className` | string | `""` | appended to the root element |

## Notes

- Pages are fixed-size; they do not reflow. To fit a narrow viewport, pass `scale`.
- Fonts are referenced by the names embedded in the PDF, with generic fallbacks. Install
  or `@font-face` the real families for an exact match.
"""

    return {
        f"{safe_name}.jsx": component,
        f"{safe_name}.css": PAGE_CSS + "\n",
        "README.md": readme,
    }
