"""Visual order in, logical order out.

**This module is why the Hebrew market is ours, and translating the engine without it
would have quietly given that away.**

A PDF stores right-to-left text the way it is painted, which is already reversed. pdf.js
runs the bidirectional algorithm over every text item and hands back logical order, so
`extract.ts` never had to think about it. pdfminer does not, so the Python engine gets
`'דסיימ ךרוע ,בוטרב ףסא'` where the TypeScript gets `'אסף ברטוב, עורך מייסד'` — the same
sentence, character-for-character backwards. That is precisely the failure situation 5 in
business/situations.md describes as our clearest differentiator, and it would have
shipped looking like a working conversion.

So this is a port of pdf.js's `src/core/bidi.js` — a compact UAX#9 implementation
written for exactly this input. It is deliberately a line-for-line translation, variable
names and all: it is subtle code, the fixtures give an exact reference to check against,
and a version rewritten to read more nicely is a version nobody can diff against the
original when a document comes out wrong.

The two character-type tables live in `_bidi_tables.py` and are extracted mechanically
from the shipped pdf.js build rather than retyped.
"""

from __future__ import annotations

from typing import NamedTuple

from _bidi_tables import ARABIC_TYPES, BASE_TYPES


class BidiText(NamedTuple):
    text: str
    dir: str


def _is_odd(value: int) -> bool:
    return (value & 1) != 0


def _is_even(value: int) -> bool:
    return (value & 1) == 0


def _find_unequal(values: list[str], start: int, value: str) -> int:
    for index in range(start, len(values)):
        if values[index] != value:
            return index
    return len(values)


def _set_values(values: list[str], start: int, end: int, value: str) -> None:
    for index in range(start, end):
        values[index] = value


def _reverse(values: list[str], start: int, end: int) -> None:
    values[start:end] = values[start:end][::-1]


def _result(text: str, is_ltr: bool, vertical: bool = False) -> BidiText:
    if vertical:
        return BidiText(text, "ttb")
    return BidiText(text, "ltr" if is_ltr else "rtl")


def bidi(text: str, start_level: int = -1, vertical: bool = False) -> BidiText:
    """Reorder one run of text from visual order into logical order.

    `start_level` of -1 auto-detects: a string that is less than 30% bidi characters and
    longer than four is treated as left-to-right, which keeps an English sentence with
    one Hebrew word in it from flipping wholesale.
    """
    is_ltr = True
    length = len(text)
    if length == 0 or vertical:
        return _result(text, is_ltr, vertical)

    chars = list(text)
    types: list[str] = []
    num_bidi = 0

    for char in chars:
        code = ord(char)
        char_type = "L"
        if code <= 0x00FF:
            char_type = BASE_TYPES[code]
        elif 0x0590 <= code <= 0x05F4:
            char_type = "R"
        elif 0x0600 <= code <= 0x06FF:
            char_type = ARABIC_TYPES[code & 0xFF]
            if not char_type:
                # pdf.js warns here. The engine has nowhere to warn to that the user
                # would see, and a single unclassified character is not worth a line in
                # the log on every Arabic document.
                char_type = "L"
        elif 0x0700 <= code <= 0x08AC or 0xFB50 <= code <= 0xFDFF or 0xFE70 <= code <= 0xFEFF:
            char_type = "AL"

        if char_type in ("R", "AL", "AN"):
            num_bidi += 1
        types.append(char_type)

    # Nothing bidirectional: the string is already in logical order, and returning here
    # is also what keeps the angle-bracket removal below away from Latin documents.
    if num_bidi == 0:
        return _result(text, True)

    if start_level == -1:
        if num_bidi / length < 0.3 and length > 4:
            is_ltr = True
            start_level = 0
        else:
            is_ltr = False
            start_level = 1

    levels = [start_level] * length

    e = "R" if _is_odd(start_level) else "L"
    sor = e
    eor = sor

    # W1: non-spacing marks take the type of the character before them.
    last_type = sor
    for i in range(length):
        if types[i] == "NSM":
            types[i] = last_type
        else:
            last_type = types[i]

    # W2: European numbers after an Arabic letter become Arabic numbers.
    last_type = sor
    for i in range(length):
        t = types[i]
        if t == "EN":
            types[i] = "AN" if last_type == "AL" else "EN"
        elif t in ("R", "L", "AL"):
            last_type = t

    # W3.
    for i in range(length):
        if types[i] == "AL":
            types[i] = "R"

    # W4: a single separator between two numbers of the same kind joins them.
    for i in range(1, length - 1):
        if types[i] == "ES" and types[i - 1] == "EN" and types[i + 1] == "EN":
            types[i] = "EN"
        if (
            types[i] == "CS"
            and types[i - 1] in ("EN", "AN")
            and types[i + 1] == types[i - 1]
        ):
            types[i] = types[i - 1]

    # W5: a run of European terminators adjacent to a European number joins it.
    for i in range(length):
        if types[i] == "EN":
            for j in range(i - 1, -1, -1):
                if types[j] != "ET":
                    break
                types[j] = "EN"
            for j in range(i + 1, length):
                if types[j] != "ET":
                    break
                types[j] = "EN"

    # W6.
    for i in range(length):
        if types[i] in ("WS", "ES", "ET", "CS"):
            types[i] = "ON"

    # W7: European numbers after a left-to-right character become left-to-right.
    last_type = sor
    for i in range(length):
        t = types[i]
        if t == "EN":
            types[i] = "L" if last_type == "L" else "EN"
        elif t in ("R", "L"):
            last_type = t

    # N1: neutrals between two characters of the same direction take that direction.
    i = 0
    while i < length:
        if types[i] == "ON":
            end = _find_unequal(types, i + 1, "ON")
            before = types[i - 1] if i > 0 else sor
            after = types[end + 1] if end + 1 < length else eor
            if before != "L":
                before = "R"
            if after != "L":
                after = "R"
            if before == after:
                _set_values(types, i, end, before)
            i = end
            continue
        i += 1

    # N2: remaining neutrals take the paragraph direction.
    for i in range(length):
        if types[i] == "ON":
            types[i] = e

    # I1 and I2: resolve implicit levels.
    for i in range(length):
        t = types[i]
        if _is_even(levels[i]):
            if t == "R":
                levels[i] += 1
            elif t in ("AN", "EN"):
                levels[i] += 2
        elif t in ("L", "AN", "EN"):
            levels[i] += 1

    highest_level = -1
    lowest_odd_level = 99
    for level in levels:
        if highest_level < level:
            highest_level = level
        if lowest_odd_level > level and _is_odd(level):
            lowest_odd_level = level

    # L2: reverse each level run, highest level first.
    for level in range(highest_level, lowest_odd_level - 1, -1):
        start = -1
        for i in range(len(levels)):
            if levels[i] < level:
                if start >= 0:
                    _reverse(chars, start, i)
                    start = -1
            elif start < 0:
                start = i
        if start >= 0:
            _reverse(chars, start, len(levels))

    # Inherited from pdf.js, and questionable: it deletes angle brackets outright from
    # any bidirectional string. Kept so the two engines agree character for character
    # on the fixtures, and recorded in the backlog as something to revisit — a converter
    # silently dropping characters from a document is a bug, whoever wrote it first.
    # Note it never touches Latin-only text, which returns above.
    for i, char in enumerate(chars):
        if char in ("<", ">"):
            chars[i] = ""

    return _result("".join(chars), is_ltr)
