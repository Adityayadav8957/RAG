"""Append-only audit trail.

Audit writes use their own short transaction so they are persisted even when the request's
transaction rolls back (e.g. a denied action must still be recorded).
"""

from __future__ import annotations

import re
import uuid
from typing import Any

from app.db.models import AuditLog
from app.db.session import get_sessionmaker
from app.logging import get_logger, request_id_ctx
from app.security.pii import mask_pii

log = get_logger("audit")


_SENSITIVE_KEYS = re.compile(r"(?i)pass(word|wd)?|secret|token|authorization|api[_-]?key|credential")


def _scrub(value: Any) -> Any:
    if isinstance(value, str):
        return mask_pii(value)[:2000]
    if isinstance(value, dict):
        return {
            str(k): "[REDACTED]" if _SENSITIVE_KEYS.search(str(k)) else _scrub(v) for k, v in value.items()
        }
    if isinstance(value, list | tuple):
        return [_scrub(v) for v in value][:50]
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


async def audit(
    event: str,
    *,
    actor_id: uuid.UUID | None,
    resource: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    clean = _scrub(details or {})
    log.info("audit", audit_event=event, resource=resource, details=clean)
    try:
        async with get_sessionmaker()() as session:
            session.add(
                AuditLog(
                    actor_id=actor_id,
                    event=event,
                    resource=resource,
                    request_id=request_id_ctx.get(),
                    details=clean,
                )
            )
            await session.commit()
    except Exception:  # noqa: BLE001
        # Never let an audit-store outage take down the request path, but make it loud.
        log.error("audit_write_failed", audit_event=event, exc_info=True)
