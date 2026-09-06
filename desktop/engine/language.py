"""Script detection, for <html lang> and dir.

A translation of src/converter/language.ts. Not full language identification —
distinguishing Spanish from Portuguese needs statistics and is not worth the weight. But
declaring a Hebrew document as English is a real accessibility failure: screen readers
pick the wrong voice, hyphenation and font fallback go wrong, and the direction of the
whole page is wrong.

WARNING, carried over from the TypeScript because it applies here word for word.
Every range below is written with \\u escapes rather than literal characters. Some of
these ranges contain presentation forms such as U+FB1D, which are canonically
decomposable: one Unicode normalisation pass over this file — any tool that rewrites it
through NFD — splits that into two code points and turns the Hebrew range into one
starting at U+05B4, which then matches most of the Basic Multilingual Plane, Latin and
CJK included. The bug is silent. Everything still runs, and every document is reported
as right-to-left. If you touch these, run test_engine.py and confirm that only the
Hebrew fixture reports RTL.
"""

from __future__ import annotations

import re
from typing import NamedTuple

from model import Direction


class Script(NamedTuple):
    lang: str
    dir: Direction
    pattern: re.Pattern[str]


SCRIPTS: list[Script] = [
    Script("he", "rtl", re.compile("[֐-׿יִ-ﭏ]")),
    Script("ar", "rtl", re.compile("[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]")),
    Script("el", "ltr", re.compile("[Ͱ-Ͽἀ-῿]")),
    Script("ru", "ltr", re.compile("[Ѐ-ӿ]")),
    Script("ja", "ltr", re.compile("[぀-ヿ]")),
    Script("ko", "ltr", re.compile("[가-힯]")),
    Script("zh", "ltr", re.compile("[一-鿿]")),
]

# Any right-to-left script, for marking individual runs. Wider than the Hebrew and
# Arabic ranges above because it also covers Syriac, Thaana, NKo and the Arabic
# supplements — a run only needs to know which way it goes, not which language it is.
RTL_SCRIPT = re.compile("[֐-ࣿיִ-﷿ﹰ-﻿]")

# Below this, a few stray glyphs in an otherwise English document would relabel it.
MIN_EVIDENCE = 12


def detect_language(text: str | None) -> tuple[str, Direction]:
    """Return (lang, dir) for a sample of a document's text."""
    sample = text or ""
    best: Script | None = None
    best_count = 0

    for script in SCRIPTS:
        count = len(script.pattern.findall(sample))
        if count > best_count:
            best_count = count
            best = script

    if best is not None and best_count >= MIN_EVIDENCE:
        return best.lang, best.dir
    return "en", "ltr"


def is_rtl(text: str | None) -> bool:
    """Whether a run contains right-to-left script."""
    return bool(RTL_SCRIPT.search(text or ""))
