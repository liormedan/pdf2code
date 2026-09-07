"""Turning a failure to open a document into something a person can act on.

`ERROR_CODES` in protocol.py has carried `ENCRYPTED` and `UNREADABLE` since sprint 2,
copied across from the TypeScript along with the rest of the vocabulary. **Nothing ever
emitted either of them.** Every document that failed to open — truncated, empty, a text
file somebody renamed, a file another program had open — arrived at the window as
`INTERNAL` carrying PDFium's own words:

    Failed to load document (PDFium: Data format error).

Which is a library's internal message, is identical for all four causes, and tells the
person nothing they can do. This module is what tells them apart.

**The exception is not enough to do it.** PDFium reports a locked file and a corrupt file
with the same "Data format error", so classification reads the file itself: is it there,
can it be read at all, is it empty, does it even begin with `%PDF`. Those questions are
cheap, they are answerable after the failure, and each one has a different answer for the
person holding the document.

The engine still returns a **code**, never a sentence — the window owns the wording, in
whichever language it is running in. The message here is for the log.
"""

from __future__ import annotations

from pathlib import Path

#: The first bytes of every PDF. A file that does not start with this is not a damaged
#: PDF, it is a different kind of file, and saying so saves somebody hunting for
#: corruption that was never there.
MAGIC = b"%PDF"

#: Enough to see the header. Deliberately tiny: this runs on a file we already suspect,
#: which may be enormous or may be on a disconnected drive.
PEEK = 1024


#: Windows and POSIX both have a way of saying each of these, and an operation that
#: cannot write is a different problem from a document that cannot be read.
DISK_FULL = {112, 39}          # ERROR_DISK_FULL, ERROR_HANDLE_DISK_FULL
NO_SUCH_PLACE = {3, 267, 161}  # PATH_NOT_FOUND, DIRECTORY, BAD_PATHNAME
IN_THE_WAY = {183, 80}         # ALREADY_EXISTS, FILE_EXISTS
DENIED = {5, 19, 32}           # ACCESS_DENIED, WRITE_PROTECT, SHARING_VIOLATION


def classify(
    error: BaseException,
    path: str | Path | None,
    out: str | Path | None = None,
) -> tuple[str, str]:
    """Return the (code, log message) for a failed job.

    Ordered from the most specific cause to the least, because several of them produce
    the same exception and only the order distinguishes them. `out` is checked first when
    the failure looks like a write: a document that opened fine and an output that could
    not be written is a different problem, and telling somebody their document is damaged
    when their disk is full sends them to fix the wrong thing.
    """
    detail = str(error)

    written = _from_write(error, out)
    if written is not None:
        return written

    if path is None:
        return _from_exception(error, detail)

    document = Path(path)

    # Asked about a file that is not there. Common enough to deserve its own answer:
    # a project re-run after somebody moved the document lands exactly here.
    if not document.exists():
        return "UNREADABLE", f"no such file: {document.name}"

    if document.is_dir():
        return "UNREADABLE", f"{document.name} is a folder, not a document"

    try:
        size = document.stat().st_size
    except OSError as stat_error:
        return "UNREADABLE", f"could not read {document.name}: {stat_error}"

    if size == 0:
        return "UNREADABLE", f"{document.name} is empty"

    # Reading the first bytes answers two questions at once: whether anything can read
    # the file at all, and whether it is a PDF. A file another program holds open fails
    # here, and PDFium's message for that is the same one it gives for corruption.
    try:
        with document.open("rb") as handle:
            head = handle.read(PEEK)
    except PermissionError:
        return "UNREADABLE", f"{document.name} is open in another program"
    except OSError as read_error:
        return "UNREADABLE", f"could not read {document.name}: {read_error}"

    if not head.startswith(MAGIC):
        return "UNREADABLE", f"{document.name} is not a PDF"

    return _from_exception(error, detail)


def _from_exception(error: BaseException, detail: str) -> tuple[str, str]:
    """What the exception alone can tell us, once the file has been ruled out."""
    lowered = detail.lower()

    # PDFium distinguishes these two and they mean different things to the person: one
    # needs a password, the other uses a scheme this build cannot open at all.
    if "password" in lowered:
        return "ENCRYPTED", "the document needs a password"
    if "security" in lowered:
        return "ENCRYPTED", "the document uses a protection scheme we cannot open"

    if isinstance(error, PermissionError):
        return "UNREADABLE", "the file is open in another program"

    # It begins with %PDF, it is readable, and PDFium still refused it.
    if "format" in lowered or "load document" in lowered:
        return "UNREADABLE", "the document is damaged"

    # Not a document problem at all. Kept as INTERNAL so it stays visible as a bug in
    # us rather than being explained away as a bad file.
    return "INTERNAL", detail


def _from_write(error: BaseException, out: str | Path | None) -> tuple[str, str] | None:
    """Whether this was a failure to write, and what to say about it.

    Returns None when the error is not about writing, so the caller falls through to the
    read classification. Keyed on the operating system's own error number rather than on
    the message, because the message is localised — on a Hebrew Windows these arrive in
    Hebrew, and matching English words against them would quietly stop working on exactly
    the machines this product is for.
    """
    # No output path means the job was not writing anywhere, so nothing here applies.
    # This guard is load-bearing: a locked *source* raises PermissionError too, and
    # without it a document somebody had open in another program would be reported as a
    # place we could not write to.
    if out is None or not isinstance(error, OSError):
        return None

    number = getattr(error, "winerror", None) or error.errno
    if number is None:
        return None

    where = f" ({Path(out).name})"

    if number in DISK_FULL or number == 28:  # 28 is ENOSPC
        return "UNWRITABLE", f"there is not enough room on the disk{where}"
    if number in NO_SUCH_PLACE or number == 2:  # 2 is ENOENT
        return "UNWRITABLE", f"that folder does not exist any more{where}"
    if number in IN_THE_WAY:
        return "UNWRITABLE", f"there is a file where that folder should be{where}"
    if number in DENIED or number == 13:  # 13 is EACCES
        return "UNWRITABLE", f"no permission to write there{where}"

    return None
