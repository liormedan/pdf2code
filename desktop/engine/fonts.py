"""Recovering typography from a PDF.

A translation of src/converter/fonts.ts. The tables below are not code so much as
accumulated evidence: each entry was added because a real document in the fixture set
was mis-rendered without it. That is why this is translated line for line rather than
rewritten — the regexes are the asset.

What changed in the move, and only this: pdf.js exposed two names per font, a CSS guess
from getTextContent() and the real embedded name from commonObjs once the operator list
had been built. pdfminer hands us the embedded name directly on every character —
`MUFUZY+Alef-Regular` — so the second source is gone and the `css_hint` argument is now
only a fallback for a font with no name at all.
"""

from __future__ import annotations

import re
from typing import Iterable

from model import FontDescription

SUBSET_PREFIX = re.compile(r"^[A-Z]{6}\+")

# Substring signals, most specific first — "CMTT" must beat "CM".
SERIF = re.compile(
    r"times|nimbusrom|cmr|cmbx|cmti|georgia|garamond|book|minion|caslon|palatino"
    r"|cambria|constantia|didot|baskerville|frank|david|narkis",
    re.I,
)
MONO = re.compile(r"courier|cmtt|sftt|mono|consol|menlo|inconsolata|source ?code", re.I)
BOLD = re.compile(r"bold|black|heavy|semibold|demi|medi(?!um ?condensed)|[-_]bd\b", re.I)
LIGHT = re.compile(r"light|thin|extralight|ultralight", re.I)
# PDF font names abbreviate aggressively — the corpus contains "NimbusRomNo9L-ReguItal"
# and "-MediItal", which a plain /italic/ never matches. The negative lookaheads keep
# "Ital" from firing inside words like "Capitalis".
ITALIC = re.compile(r"italic|oblique|ital(?![a-z])|obl(?![a-z])|slant", re.I)

GENERIC = re.compile(r"^(serif|sans-serif|monospace|cursive|fantasy)$", re.I)

# Families we can name outright, so the renderer uses the real face when it has it.
KNOWN: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"alef", re.I), "Alef"),
    (re.compile(r"arial", re.I), "Arial"),
    (re.compile(r"helvetica", re.I), "Helvetica"),
    (re.compile(r"calibri", re.I), "Calibri"),
    (re.compile(r"verdana", re.I), "Verdana"),
    (re.compile(r"tahoma", re.I), "Tahoma"),
    (re.compile(r"times", re.I), "Times New Roman"),
    (re.compile(r"georgia", re.I), "Georgia"),
    (re.compile(r"garamond", re.I), "Garamond"),
    (re.compile(r"courier", re.I), "Courier New"),
    (re.compile(r"cambria", re.I), "Cambria"),
    (re.compile(r"segoe", re.I), "Segoe UI"),
    (re.compile(r"david", re.I), "David"),
    (re.compile(r"narkis", re.I), "Narkisim"),
    (re.compile(r"frank", re.I), "FrankRuehl"),
    (re.compile(r"nimbusrom", re.I), "Times New Roman"),
    (re.compile(r"^cm(r|bx|ti)", re.I), "CMU Serif"),
    (re.compile(r"^cmtt|^sftt", re.I), "CMU Typewriter Text"),
]

_UNQUOTABLE = re.compile(r"['\"\\]")


def base_name(name: str | None) -> str:
    """Strip the subset tag PDFs prepend to embedded fonts ("MUFUZY+Alef" -> "Alef")."""
    return SUBSET_PREFIX.sub("", str(name or "")).strip()


def _quoted(name: str) -> str:
    # Single quotes, not double: this string ends up inside style="…" in the generated
    # HTML, and double quotes there terminate the attribute and corrupt the document.
    # CSS accepts either, so single quotes cost nothing and remove the hazard entirely.
    return f"'{_UNQUOTABLE.sub('', name)}'"


def describe_font(raw_name: str | None, css_hint: str | None = None) -> FontDescription:
    """Turn a PDF font name into a CSS description."""
    name = base_name(raw_name)

    # Weight and style live in the name itself, not in any separate PDF field.
    weight = 700 if BOLD.search(name) else 300 if LIGHT.search(name) else 400
    style = "italic" if ITALIC.search(name) else "normal"

    if MONO.search(name):
        generic = "monospace"
    elif SERIF.search(name):
        generic = "serif"
    elif name:
        generic = "sans-serif"
    else:
        # Nothing to go on — fall back to whatever the caller guessed.
        generic = css_hint or "sans-serif"

    known = next((family for pattern, family in KNOWN if pattern.search(name)), None)
    if known:
        family = f"{_quoted(known)}, {generic}"
    elif name:
        family = f"{_quoted(name)}, {generic}"
    else:
        family = generic

    return FontDescription(
        family=family, weight=weight, style=style, generic=generic, name=name
    )


def resolve_page_fonts(font_names: Iterable[str]) -> dict[str, FontDescription]:
    """Describe every font a page used, keyed by the raw name the runs refer to.

    The key stays the *raw* name, subset prefix and all, because that is what each run
    carries — two subsets of the same family are two entries here on purpose, since a
    document can embed `ABCDEF+Alef-Regular` and `GHIJKL+Alef-Regular` with different
    glyph coverage.
    """
    return {raw: describe_font(raw) for raw in dict.fromkeys(font_names)}
