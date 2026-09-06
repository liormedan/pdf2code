"""What the engine can be asked to do.

Two operations in this sprint, and neither converts anything. That is the point: the
contract, the threading, the progress and the cancellation are the risky parts, and
they are worth getting right against work that cannot fail for its own reasons. The
converter arrives in sprint 3 behind exactly this interface — `convert` becomes one
more entry in OPS, and nothing above it changes.

Every operation takes (args, ctx) and returns the payload of a `result`. To report
progress it calls `ctx.progress(...)`; to be cancellable it checks `ctx.cancelled`
often enough that a person clicking Cancel sees it stop.
"""

from __future__ import annotations

import time
from typing import Any, Callable, Protocol


class Cancelled(Exception):
    """Raised by a checkpoint when the job has been asked to stop.

    An exception rather than a return value, so that a deeply nested loop cannot
    forget to propagate it — which is exactly how cancellation quietly stops working.
    """


class Context(Protocol):
    """What an operation may do to the outside world. Nothing else."""

    @property
    def cancelled(self) -> bool: ...

    def progress(self, *, page: int, pages: int, phase: str) -> None: ...

    def checkpoint(self) -> None:
        """Raise Cancelled if a cancel has arrived."""


def op_echo(args: dict[str, Any], ctx: Context) -> dict[str, Any]:
    """Return what you were given.

    The smallest possible proof that the whole chain is intact: React invoked Rust,
    Rust framed a line, Python parsed it, and the answer came back matched to its id.
    """
    return {"echo": args.get("value")}


def op_sleep(args: dict[str, Any], ctx: Context) -> dict[str, Any]:
    """Do nothing, slowly, in steps — a stand-in for a real conversion.

    It exists to exercise the two things that are genuinely hard to get right and
    trivial to fake: progress that arrives *during* the work rather than after it, and
    a cancel that lands while a worker thread is busy.
    """
    steps = max(1, min(int(args.get("steps", 10)), 1000))
    every = max(0.0, float(args.get("seconds", 0.1)))
    phase = args.get("phase", "extract")

    for step in range(1, steps + 1):
        # Checked before the sleep as well as after, so a cancel that arrives during
        # the very first step is still honoured.
        ctx.checkpoint()
        time.sleep(every)
        ctx.progress(page=step, pages=steps, phase=phase)

    return {"slept": steps * every, "steps": steps}


OPS: dict[str, Callable[[dict[str, Any], Context], dict[str, Any]]] = {
    "echo": op_echo,
    "sleep": op_sleep,
}
