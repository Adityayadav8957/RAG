"""Structured, user-visible trace of what the agent did for one request.

Each step becomes a ``trace`` SSE event, and the whole list is stored with the assistant
message so the "Agent activity" panel can replay any past answer. Details are limited to
what the caller is already allowed to see (their own text, titles of documents they can read,
tool names and arguments). Document text and secrets are never included.
"""

from __future__ import annotations

import time
from typing import Any, Literal

Status = Literal["running", "done", "blocked", "skipped", "waiting", "error"]


class Trace:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []
        self._pending: list[dict[str, Any]] = []
        self._t0 = time.perf_counter()

    def step(
        self,
        stage: str,
        title: str,
        *,
        status: Status = "done",
        ms: float | None = None,
        **detail: Any,
    ) -> None:
        event = {
            "type": "trace",
            "seq": len(self.events),
            "stage": stage,
            "title": title,
            "status": status,
            "at_ms": round((time.perf_counter() - self._t0) * 1000),
            "ms": None if ms is None else round(ms),
            "detail": detail,
        }
        self.events.append(event)
        self._pending.append(event)

    def drain(self) -> list[dict[str, Any]]:
        """Events recorded since the last drain; the caller yields them to the client."""
        out, self._pending = self._pending, []
        return out

    @property
    def total_ms(self) -> int:
        return round((time.perf_counter() - self._t0) * 1000)


def elapsed_ms(start: float) -> float:
    return (time.perf_counter() - start) * 1000
