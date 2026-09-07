"""Run the engine's test suites, and say plainly which ones could not run.

    .venv/Scripts/python.exe run_suites.py

Seven suites, and **not all of them can run everywhere.** `fixtures/*.pdf` is excluded
from the repository by `.gitignore`, and that exclusion is deliberate: the corpus is real
third-party documents — an arXiv paper, an ACM paper carrying its own copyright notice —
and this repository is public. Committing five megabytes of somebody else's work to it is
a licensing question rather than a convenience, and it is not one a build script should
answer on its own.

So on a clean checkout most of the corpus is absent, and the suites that need it cannot
run. The failure mode this script exists to prevent is the quiet one: a CI run that is
green because six suites skipped and nobody noticed. **A skipped suite is reported as
loudly as a failing one**, counted separately, and named — so "all green" always means
the same thing.

Exit code is non-zero if anything failed. Skips do not fail the run, because a document we
chose not to ship is not a defect; they are printed, counted, and summarised at the end.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
FIXTURES = HERE.parent.parent / "fixtures"

#: Every suite, with the fixtures it cannot run without. An empty set means it runs
#: anywhere — which is worth knowing, because those are the ones CI can always rely on.
SUITES: dict[str, set[str]] = {
    "test_archive.py": set(),
    "test_protocol.py": set(),  # skips its probe check on its own if the fixture is gone
    "test_failures.py": {"08-hebrew-doc.pdf"},
    "test_paths.py": {"08-hebrew-doc.pdf"},
    "test_pages.py": {"08-hebrew-doc.pdf", "07-academic-tables.pdf"},
    "test_output.py": {"09-hostile-text.pdf"},
    "test_engine.py": {
        "04-scanned-ccitt.pdf",
        "05-image-heavy.pdf",
        "06-annotations.pdf",
        "07-academic-tables.pdf",
        "08-hebrew-doc.pdf",
        "09-hostile-text.pdf",
        "10-large-150p.pdf",
    },
}


def main() -> int:
    ran: list[str] = []
    failed: list[str] = []
    skipped: list[tuple[str, list[str]]] = []

    for suite, needs in SUITES.items():
        missing = sorted(name for name in needs if not (FIXTURES / name).exists())
        if missing:
            skipped.append((suite, missing))
            print(f"SKIP  {suite:20} needs {', '.join(missing)}")
            continue

        result = subprocess.run([sys.executable, suite], cwd=HERE)
        if result.returncode == 0:
            ran.append(suite)
            print(f"PASS  {suite}")
        else:
            failed.append(suite)
            print(f"FAIL  {suite}")

    print()
    print(f"{len(ran)} passed, {len(failed)} failed, {len(skipped)} skipped")

    if skipped:
        print()
        print("Suites that did not run, and why:")
        for suite, missing in skipped:
            print(f"  {suite:20} {', '.join(missing)}")
        print()
        print("  Those documents are third-party and excluded from this public repository")
        print("  on purpose. They live on a development machine; see desktop/backlog.md,")
        print("  sprint 6. This run proves nothing about the paths they cover.")

    if failed:
        print(f"\n{len(failed)} suite(s) failed: {', '.join(failed)}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
