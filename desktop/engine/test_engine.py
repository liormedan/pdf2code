"""Parity checks: does the Python engine agree with the TypeScript one?

    .venv/Scripts/python.exe test_engine.py

The question this answers is narrow and exact. `fonts.py` and `language.py` are
translations of code that already works and is covered by the existing suites, so the
only thing that can go wrong is the translation itself — a regex whose semantics shifted
between JavaScript and Python, a lookahead dropped, a Unicode range that got normalised
on the way over. Feeding both implementations the same inputs and comparing the output
finds all three.

`parity/expected.json` is what the TypeScript produced, committed so these checks run
without a Node toolchain. Regenerate it with:

    npx tsx desktop/engine/parity/dump.mts

If that regeneration changes the file, the TypeScript changed — which is worth seeing as
a diff rather than discovering as a drift.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from extract import extract_page, inspect
from fonts import base_name, describe_font
from language import detect_language, is_rtl
from model import round2

HERE = Path(__file__).parent
EXPECTED = HERE / "parity" / "expected.json"
PAGES = HERE / "parity" / "pages.json"
FIXTURES = HERE.parent.parent / "fixtures"

# Differences we have measured, understood and chosen not to fix yet. The key is the
# fixture; the values are the first 24 characters of each affected run, matching how
# the positional check reports them. Anything not listed here is a failure.
KNOWN_DIFFERENCES: dict[str, set[str]] = {
    # Spaces inside text rotated ninety degrees come out as separate runs. Position,
    # size, angle and every character are correct; only the run boundaries differ.
    # See desktop/backlog.md, sprint 3.
    "07-academic-tables.pdf": {"arXiv:1706.03762v7 [cs.C"},
}

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    if not ok:
        FAILURES.append(name)
        print(f"  FAIL  {name}{f'  — {detail}' if detail else ''}")


def report(section: str, total: int) -> None:
    failed = len(FAILURES)
    print(f"  {'ok  ' if failed == 0 else 'FAIL'}  {section}: {total} cases")


def check_fonts(cases: list[dict]) -> None:
    before = len(FAILURES)
    for case in cases:
        raw, hint = case["input"]
        got = describe_font(raw, hint)
        label = repr(raw)
        check(f"font {label} family", got.family == case["family"], f"{got.family!r} != {case['family']!r}")
        check(f"font {label} weight", got.weight == case["weight"], f"{got.weight} != {case['weight']}")
        check(f"font {label} style", got.style == case["style"], f"{got.style} != {case['style']}")
        check(f"font {label} generic", got.generic == case["generic"], f"{got.generic} != {case['generic']}")
        check(f"font {label} name", got.name == case["name"], f"{got.name!r} != {case['name']!r}")
    print(f"  {'ok  ' if len(FAILURES) == before else 'FAIL'}  fonts: {len(cases)} cases agree with the TypeScript")


def check_languages(cases: list[dict]) -> None:
    before = len(FAILURES)
    for case in cases:
        sample = case["input"]
        lang, direction = detect_language(sample)
        label = repr(sample[:24])
        check(f"lang {label}", lang == case["lang"], f"{lang} != {case['lang']}")
        check(f"dir {label}", direction == case["dir"], f"{direction} != {case['dir']}")
    print(f"  {'ok  ' if len(FAILURES) == before else 'FAIL'}  languages: {len(cases)} cases agree with the TypeScript")


def check_unicode_ranges() -> None:
    """The failure the comments in language.py warn about, made into a test.

    A normalisation pass over language.py splits U+FB1D into two code points and turns
    the Hebrew range into one that matches most of the Basic Multilingual Plane. Nothing
    breaks; every document simply becomes right-to-left. These three lines are what
    would notice.
    """
    before = len(FAILURES)
    check("Latin is not RTL", not is_rtl("Hello world"))
    check("CJK is not RTL", not is_rtl("你好世界こんにちは"))
    check("Cyrillic is not RTL", not is_rtl("Привет мир"))
    check("Hebrew is RTL", is_rtl("שלום"))
    check("Arabic is RTL", is_rtl("مرحبا"))
    check("Hebrew presentation forms are RTL", is_rtl("שׁוֹ"))
    print(f"  {'ok  ' if len(FAILURES) == before else 'FAIL'}  unicode ranges did not widen")


def check_subset_prefix() -> None:
    before = len(FAILURES)
    check("six caps and a plus are stripped", base_name("MUFUZY+Alef-Regular") == "Alef-Regular")
    check("five caps are not a subset tag", base_name("MUFUZ+Alef") == "MUFUZ+Alef")
    check("lowercase is not a subset tag", base_name("mufuzy+Alef") == "mufuzy+Alef")
    check("a bare name is untouched", base_name("Alef-Regular") == "Alef-Regular")
    check("None is empty", base_name(None) == "")
    print(f"  {'ok  ' if len(FAILURES) == before else 'FAIL'}  subset prefixes")


def check_rounding() -> None:
    """Python rounds halves to even; JavaScript's Math.round rounds them up.

    On a coordinate the difference is invisible. In a field-by-field comparison of two
    models it is noise, so round2 imitates JavaScript rather than Python.
    """
    before = len(FAILURES)
    check("halves round up like Math.round", round2(0.125) == 0.13, str(round2(0.125)))
    check("negative halves match Math.round", round2(-0.125) == -0.13, str(round2(-0.125)))
    check("ordinary values are unaffected", round2(12.3456) == 12.35, str(round2(12.3456)))
    print(f"  {'ok  ' if len(FAILURES) == before else 'FAIL'}  rounding matches Math.round")


def check_pages() -> None:
    """The page model, against what the TypeScript produced for the same fixtures.

    Three tiers, because not everything can or should match exactly:

    * **Exact** — page geometry, document metadata, language, direction, the scanned
      flag, and the set of embedded fonts. Any difference here is a bug.
    * **Positional** — every run the TypeScript found must exist in the Python model at
      the same x and y, with the same text. This is the real check, and it is the one
      that would have caught the Hebrew being backwards.
    * **Loose** — run *boundaries* and `stats` counts. pdf.js groups glyphs into items
      itself and counts painting operators; pdfminer hands back characters and a laid
      out tree. Demanding the same numbers there would be demanding the two libraries
      be the same library.
    """
    reference = json.loads(PAGES.read_text(encoding="utf-8"))

    for name, expected in reference.items():
        before = len(FAILURES)
        path = FIXTURES / name
        if not path.exists():
            print(f"  skip  {name} — fixture missing")
            continue

        model = extract_page(path, 1)
        info = inspect(path)
        exp_page = expected["page"]
        exp_info = expected["info"]

        check(f"{name} width", model.width == exp_page["width"], f"{model.width} != {exp_page['width']}")
        check(f"{name} height", model.height == exp_page["height"], f"{model.height} != {exp_page['height']}")

        check(f"{name} pages", info.pages == exp_info["pages"], f"{info.pages} != {exp_info['pages']}")
        check(f"{name} lang", info.lang == exp_info["lang"], f"{info.lang} != {exp_info['lang']}")
        check(f"{name} dir", info.dir == exp_info["dir"], f"{info.dir} != {exp_info['dir']}")
        check(f"{name} scanned", info.scanned == exp_info["scanned"], f"{info.scanned} != {exp_info['scanned']}")
        check(f"{name} hasRTL", info.has_rtl == exp_info["hasRTL"], f"{info.has_rtl} != {exp_info['hasRTL']}")

        # Fonts are keyed differently — pdf.js by its own internal handle, Python by the
        # embedded name — so the identities are what get compared, not the keys.
        # Fonts that actually render something. A font used for nothing but a space —
        # 08-hebrew-doc.pdf embeds Calibri-Bold and puts one blank in it — changes no
        # pixel, and pdf.js does not report it either.
        visible = {run.font for run in model.runs if run.text.strip()}
        py_fonts = {f.name for key, f in model.fonts.items() if key in visible}
        ts_fonts = {f["name"] for f in exp_page["fonts"].values()}
        check(f"{name} fonts", py_fonts == ts_fonts, f"only py: {py_fonts - ts_fonts}, only ts: {ts_fonts - py_fonts}")

        # The decision stats feed, not the counts themselves.
        check(
            f"{name} vector presence",
            (model.stats.vector > 0) == (exp_page["stats"]["vector"] > 0),
            f"py {model.stats.vector} vs ts {exp_page['stats']['vector']}",
        )

        # Every run the TypeScript found, at the same place, saying the same thing.
        by_y: dict[float, list] = {}
        for run in model.runs:
            by_y.setdefault(round(run.y, 1), []).append(run)

        missing = []
        for exp_run in exp_page["runs"]:
            text = exp_run["text"].strip()
            if not text:
                continue  # whitespace-only runs are a grouping artefact on both sides
            candidates = by_y.get(round(exp_run["y"], 1), [])
            if not any(text in run.text for run in candidates):
                missing.append((exp_run["x"], exp_run["y"], text[:24]))

        # One known, bounded difference, listed here rather than quietly tolerated.
        #
        # Text rotated ninety degrees keeps its position, size, angle and characters,
        # but the spaces inside it come out as separate runs instead of joining the
        # line: pdfminer reports inferred spaces relative to stream order, and stream
        # order runs backwards for rotated text. On 07-academic-tables.pdf that is the
        # arXiv sidebar, and it is the only run in the fixture set affected.
        #
        # Printed on every run so it stays visible. Delete the entry, not the check,
        # when it is fixed.
        known = KNOWN_DIFFERENCES.get(name, set())
        unexpected = [m for m in missing if m[2] not in known]
        for m in missing:
            if m[2] in known:
                print(f"  known {name}: rotated run at ({m[0]}, {m[1]}) — spaces split out")

        check(
            f"{name} every TypeScript run is present at its own position",
            not unexpected,
            f"{len(unexpected)} missing, first: {unexpected[0] if unexpected else ''}",
        )

        print(f"  {'ok  ' if len(FAILURES) == before else 'FAIL'}  {name}: "
              f"{len(model.runs)} runs (ts {len(exp_page['runs'])}), {len(py_fonts)} fonts")


def main() -> int:
    if not EXPECTED.exists():
        print(f"missing {EXPECTED}. Run: npx tsx desktop/engine/parity/dump.mts")
        return 1

    expected = json.loads(EXPECTED.read_text(encoding="utf-8"))

    print("engine parity — Python against the TypeScript it was translated from")
    check_fonts(expected["fonts"])
    check_languages(expected["languages"])
    check_unicode_ranges()
    check_subset_prefix()
    check_rounding()
    check_pages()

    print()
    if FAILURES:
        print(f"{len(FAILURES)} failed")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
