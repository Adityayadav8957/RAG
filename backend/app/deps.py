"""FastAPI dependencies: services, authentication, quotas."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db.models import UsageCounter, User
from app.db.session import get_session
from app.logging import user_id_ctx
from app.security.auth import AuthError, decode_session_token
from app.security.rbac import Principal
from app.services import Services


def get_services(request: Request) -> Services:
    services: Services = request.app.state.services
    return services


ServicesDep = Annotated[Services, Depends(get_services)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def current_principal(
    services: ServicesDep,
    session: SessionDep,
    authorization: Annotated[str | None, Header()] = None,
) -> Principal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        user_id = decode_session_token(authorization[7:].strip(), services.settings)
    except AuthError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    # Roles are re-read from the database on every request, so role changes and
    # deactivation take effect immediately instead of when the token expires.
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account disabled or unknown")
    user_id_ctx.set(str(user.id))
    return Principal(
        user_id=user.id,
        email=user.email,
        name=user.name,
        roles=frozenset(user.roles),
        tenant=user.tenant,
    )


PrincipalDep = Annotated[Principal, Depends(current_principal)]


def require_roles(*roles: str):  # type: ignore[no-untyped-def]
    async def checker(principal: PrincipalDep) -> Principal:
        if not principal.has_any_role(set(roles) | {"admin"}):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")
        return principal

    return checker


class BurstLimiter:
    """Per-user sliding window. In-process, so it is per instance; the shared, durable
    limit is the daily quota in Postgres and Cloudflare's rate limiting at the edge."""

    def __init__(self) -> None:
        self._events: dict[object, deque[float]] = defaultdict(deque)

    def check(self, key: object, limit: int, window: float = 60.0) -> bool:
        now = time.monotonic()
        q = self._events[key]
        while q and now - q[0] > window:
            q.popleft()
        if len(q) >= limit:
            return False
        q.append(now)
        return True


_burst = BurstLimiter()


async def enforce_quota(settings: Settings, session: AsyncSession, principal: Principal) -> None:
    if not _burst.check(principal.user_id, settings.burst_requests_per_minute):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests; slow down.", headers={"Retry-After": "30"}
        )
    today = datetime.now(UTC).date()
    stmt = (
        pg_insert(UsageCounter)
        .values(user_id=principal.user_id, day=today, requests=1, llm_calls=0)
        .on_conflict_do_update(
            index_elements=[UsageCounter.user_id, UsageCounter.day],
            set_={"requests": UsageCounter.requests + 1},
        )
        .returning(UsageCounter.requests)
    )
    count = (await session.execute(stmt)).scalar_one()
    await session.commit()
    if count > settings.daily_request_quota:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Daily request quota reached.")
