"""Lightweight pipeline tracing: one timed, structured log line per step."""

from __future__ import annotations

import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from app.logging import get_logger
from app.observability.metrics import STEP_LATENCY

log = get_logger("trace")


@contextmanager
def span(step: str, **attrs: Any) -> Iterator[dict[str, Any]]:
    """Time a pipeline step. The yielded dict can be extended with result attributes."""
    extra: dict[str, Any] = {}
    start = time.perf_counter()
    try:
        yield extra
    except Exception as exc:
        extra["error"] = type(exc).__name__
        raise
    finally:
        elapsed = time.perf_counter() - start
        STEP_LATENCY.labels(step=step).observe(elapsed)
        log.info("span", step=step, ms=round(elapsed * 1000, 1), **attrs, **extra)
