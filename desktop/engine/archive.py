"""Packing a conversion into one file somebody can send.

A conversion writes a folder: `index.html`, or a component with its stylesheet and a
README. That is the right shape for opening in an editor and the wrong shape for putting
in an email, and until this module existed the only way to get one from the other was to
leave the app.

Deflate through the standard library. No dependency: `zipfile` has been in Python since
1.6, and adding a compression library to an installer that a customer is told to audit
would be a line on that audit for something already present.

**The refusal here is the one that costs an hour to debug otherwise.** A zip written
inside the directory being zipped grows as it is written — the walk finds the archive,
adds it, and the file it just added is now bigger. Some implementations loop; all of them
produce something wrong. So the output has to live somewhere else, and saying so is
cheaper than the eventual bug report about a 4GB zip.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

#: Deflate, not stored. Generated HTML is markup and CSS with a base64 image inside it;
#: the markup compresses to a fraction, and the image is already compressed and simply
#: does not shrink further. Nothing here is worth the memory of a higher setting.
COMPRESSION = zipfile.ZIP_DEFLATED


def zip_dir(source: str | Path, out: str | Path, *, overwrite: bool = False) -> dict:
    """Pack every file in `source` into the archive at `out`.

    One level, matching what a conversion writes. Returns the names packed, the size of
    the archive, and the size they were unpacked — the pair is what lets the window say
    something true about what the person is about to send.
    """
    source = Path(source)
    out = Path(out)

    if not source.is_dir():
        raise ValueError(f"{source.name} is not a folder")

    # See the module docstring: an archive inside the folder it is archiving is a bug
    # with a long tail. Checked resolved, so a different spelling of the same place is
    # still the same place.
    if out.resolve().parent == source.resolve():
        raise ValueError("the archive cannot be written inside the folder it packs")

    if out.exists() and not overwrite:
        raise ValueError("that file already exists; pass overwrite to replace it")

    files = sorted(entry for entry in source.iterdir() if entry.is_file())
    if not files:
        raise ValueError("there is nothing in that folder to pack")

    out.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(out, "w", compression=COMPRESSION) as archive:
        for entry in files:
            # arcname is the bare name: an archive that unpacks into a tree mirroring
            # somebody's disk layout discloses the layout and annoys whoever opens it.
            archive.write(entry, arcname=entry.name)

    return {
        "out": str(out),
        "files": [entry.name for entry in files],
        "bytes": out.stat().st_size,
        "unpacked": sum(entry.stat().st_size for entry in files),
    }
