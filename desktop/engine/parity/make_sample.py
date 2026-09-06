"""Build a sample PDF for trying the app by hand.

    .venv/Scripts/python.exe parity/make_sample.py [out.pdf]

The fixture corpus is for the test suites. This is for a person: one page, dropped into
the window, that shows at a glance whether the thing works — and that fails visibly
rather than subtly if it does not.

**The Hebrew is stored in visual order, reversed, which is what real producers do.** A
PDF has no concept of bidirectional text: Word, InDesign and LaTeX all lay the glyphs out
already reversed and store them in the order they are painted. A viewer therefore shows
them correctly by doing nothing at all, and an extractor that also does nothing gets the
sentence backwards. Writing this sample in logical order would produce a document that
looks wrong in every reader and happens to suit our engine, which is exactly the wrong
way round for a test.

So each Hebrew line here is laid out the way a producer lays it out — see `visual()` —
and if the converted output reads correctly, `bidi.py` did its job on input that looks
like the real thing.

fpdf2 is a development dependency of this script alone — it is not in requirements.txt
and the engine never imports it.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from fpdf import FPDF

HERE = Path(__file__).parent
FONT_DIR = Path("C:/Windows/Fonts")


_UPRIGHT = re.compile(r"[A-Za-z0-9]+")


def visual(text: str) -> str:
    """Lay a right-to-left line out the way a producer does.

    Reverse the line, then put every embedded Latin word and number back the right way
    round. That second step is the whole of it: `2026` stays `2026` and `bidi` stays
    `bidi` inside reversed Hebrew, which is what Word and InDesign write and what a
    reader sees.

    The first version of this function reversed the whole line and nothing else, and it
    was wrong in a way worth recording. Our engine read the sample back and reported
    `ה-idib` and `6202` — correct Hebrew around mangled Latin. The engine was right: it
    had been handed a document no producer would ever write, one that displays wrong in
    every viewer too. A sample that only suits the code under test is not a test.
    """
    reversed_line = text[::-1]
    return _UPRIGHT.sub(lambda m: m.group(0)[::-1], reversed_line)


def build(out: Path) -> None:
    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(False)
    pdf.add_page()

    # Arial carries Hebrew on every Windows install, and embedding it is what makes the
    # sample behave like a document somebody actually produced.
    pdf.add_font("Arial", "", str(FONT_DIR / "arial.ttf"))
    pdf.add_font("Arial", "B", str(FONT_DIR / "arialbd.ttf"))

    # --- vector art, so the page needs a raster layer -------------------------------
    # Without this the page is pure text, classify_page says so, and the two-layer
    # rendering the product is built on never gets exercised.
    pdf.set_fill_color(13, 107, 91)
    pdf.rect(0, 0, 210, 26, style="F")
    pdf.set_draw_color(148, 144, 128)
    pdf.set_line_width(0.4)
    pdf.line(20, 96, 190, 96)
    pdf.set_fill_color(230, 242, 239)
    pdf.rect(20, 150, 170, 34, style="F")
    for i in range(6):
        pdf.set_fill_color(13 + i * 12, 107, 91)
        pdf.rect(24 + i * 27, 196 + (5 - i) * 3, 20, 8 + i * 5, style="F")

    # --- the heading, in the green band ---------------------------------------------
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Arial", "B", 20)
    pdf.set_xy(20, 8)
    pdf.cell(170, 10, visual("מסמך בדיקה — עברית, פיסוק ומספרים"), align="R")

    pdf.set_text_color(23, 21, 15)

    # --- Hebrew paragraph, with the punctuation that bidi has to place --------------
    pdf.set_font("Arial", "", 12)
    lines = [
        "שורה ראשונה: אם אתם קוראים את זה נכון, ה-bidi עבד.",
        "הפסיק, הנקודתיים והנקודה צריכים לשבת בסוף המשפט.",
        "מספרים בתוך עברית: בשנת 2026 הומרו 150 עמודים.",
        "מירכאות ״כאלה״ וסוגריים (כאלה) הם המקרים הקשים.",
    ]
    y = 40
    for line in lines:
        pdf.set_xy(20, y)
        pdf.cell(170, 8, visual(line), align="R")
        y += 9

    # --- English, left to right, unreversed ------------------------------------------
    pdf.set_font("Arial", "B", 12)
    pdf.set_xy(20, 104)
    pdf.cell(170, 8, "English on the same page, left to right", align="L")

    pdf.set_font("Arial", "", 11)
    for i, line in enumerate(
        [
            "The text layer stays real text: selectable, searchable, translatable.",
            "The bar above and the blocks below are vector art, so this page needs",
            "a raster layer underneath — which is the whole two-layer idea.",
        ]
    ):
        pdf.set_xy(20, 114 + i * 7)
        pdf.cell(170, 6, line, align="L")

    # --- mixed line, the hardest case ------------------------------------------------
    pdf.set_font("Arial", "", 12)
    pdf.set_xy(24, 158)
    pdf.cell(162, 8, visual("שורה מעורבת עם PDF ועם HTML בתוך עברית"), align="R")
    pdf.set_font("Arial", "", 9)
    pdf.set_xy(24, 168)
    pdf.cell(162, 6, visual("צבעים, קווים וצורות — כדי שיהיה מה לרנדר מתחת לטקסט"), align="R")

    pdf.set_font("Arial", "", 8)
    pdf.set_text_color(107, 102, 88)
    pdf.set_xy(20, 250)
    pdf.cell(170, 5, "pdf2code sample — generated for manual testing", align="L")

    pdf.output(str(out))


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parent / "sample-hebrew.pdf"
    build(out)
    print(f"wrote {out} ({out.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
