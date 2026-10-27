"""Per-user Jira OAuth 2.0 (3LO): connect flow helpers and token refresh.

Tool calls carry the *employee's own* Jira token, so Jira itself enforces what that person
may see or change (on-behalf-of authorization, no shared service account).
"""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db.models import IntegrationToken
from app.security.crypto import TokenCipher

AUTHORIZE_URL = "https://auth.atlassian.com/authorize"
TOKEN_URL = "https://auth.atlassian.com/oauth/token"  # noqa: S105 - public endpoint URL
RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources"
SCOPES = "read:jira-work write:jira-work read:jira-user manage:jira-project offline_access"
PROVIDER = "jira"
_STATE_ALG = "HS256"


class JiraNotConnected(Exception):
    """The user has not linked their Jira account (or the link expired)."""


def callback_url(settings: Settings) -> str:
    return f"{settings.public_base_url.rstrip('/')}/v1/integrations/jira/callback"


def make_state(user_id: uuid.UUID, settings: Settings) -> str:
    payload = {
        "uid": str(user_id),
        "n": secrets.token_urlsafe(8),
        "exp": datetime.now(UTC) + timedelta(minutes=10),
    }
    return jwt.encode(payload, settings.session_secret.get_secret_value(), algorithm=_STATE_ALG)


def read_state(state: str, settings: Settings) -> uuid.UUID:
    payload = jwt.decode(state, settings.session_secret.get_secret_value(), algorithms=[_STATE_ALG])
    return uuid.UUID(payload["uid"])


def authorize_url(user_id: uuid.UUID, settings: Settings) -> str:
    query = urlencode(
        {
            "audience": "api.atlassian.com",
            "client_id": settings.jira_oauth_client_id,
            "scope": SCOPES,
            "redirect_uri": callback_url(settings),
            "state": make_state(user_id, settings),
            "response_type": "code",
            "prompt": "consent",
        }
    )
    return f"{AUTHORIZE_URL}?{query}"


async def _token_request(settings: Settings, body: dict[str, str]) -> dict[str, Any]:
    if settings.jira_oauth_client_secret is None:
        raise JiraNotConnected("Jira integration is not configured")
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            TOKEN_URL,
            json={
                "client_id": settings.jira_oauth_client_id,
                "client_secret": settings.jira_oauth_client_secret.get_secret_value(),
                **body,
            },
        )
    if resp.status_code >= 400:
        raise JiraNotConnected("Jira rejected the authorization; please reconnect")
    return dict(resp.json())


async def complete_connect(
    session: AsyncSession, user_id: uuid.UUID, code: str, settings: Settings, cipher: TokenCipher
) -> dict[str, Any]:
    tokens = await _token_request(
        settings,
        {"grant_type": "authorization_code", "code": code, "redirect_uri": callback_url(settings)},
    )
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(RESOURCES_URL, headers={"Authorization": f"Bearer {tokens['access_token']}"})
    resp.raise_for_status()
    sites = resp.json()
    if not sites:
        raise JiraNotConnected("No Jira site is accessible with this account")
    site = sites[0]
    meta = {"cloud_id": site["id"], "site_url": site.get("url", ""), "site_name": site.get("name", "")}
    await _save(session, user_id, tokens, meta, cipher)
    return meta


async def _save(
    session: AsyncSession,
    user_id: uuid.UUID,
    tokens: dict[str, Any],
    meta: dict[str, Any] | None,
    cipher: TokenCipher,
) -> IntegrationToken:
    row = (
        await session.execute(
            select(IntegrationToken).where(
                IntegrationToken.user_id == user_id, IntegrationToken.provider == PROVIDER
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = IntegrationToken(user_id=user_id, provider=PROVIDER, access_token_enc="", meta=meta or {})
        session.add(row)
    row.access_token_enc = cipher.encrypt(tokens["access_token"])
    if tokens.get("refresh_token"):
        row.refresh_token_enc = cipher.encrypt(tokens["refresh_token"])
    row.expires_at = datetime.now(UTC) + timedelta(seconds=int(tokens.get("expires_in", 3600)))
    if meta is not None:
        row.meta = meta
    row.updated_at = datetime.now(UTC)
    await session.flush()
    return row


async def get_access(
    session: AsyncSession, user_id: uuid.UUID, settings: Settings, cipher: TokenCipher
) -> tuple[str, str]:
    """Return ``(access_token, cloud_id)``, refreshing (and rotating) the token when needed."""
    row = (
        await session.execute(
            select(IntegrationToken).where(
                IntegrationToken.user_id == user_id, IntegrationToken.provider == PROVIDER
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise JiraNotConnected("Connect your Jira account to use Jira tools")
    expiring = row.expires_at is None or row.expires_at <= datetime.now(UTC) + timedelta(seconds=60)
    if expiring:
        if not row.refresh_token_enc:
            raise JiraNotConnected("Your Jira connection expired; please reconnect")
        tokens = await _token_request(
            settings,
            {"grant_type": "refresh_token", "refresh_token": cipher.decrypt(row.refresh_token_enc)},
        )
        row = await _save(session, user_id, tokens, None, cipher)
        await session.commit()
    return cipher.decrypt(row.access_token_enc), str(row.meta["cloud_id"])


async def disconnect(session: AsyncSession, user_id: uuid.UUID) -> None:
    row = (
        await session.execute(
            select(IntegrationToken).where(
                IntegrationToken.user_id == user_id, IntegrationToken.provider == PROVIDER
            )
        )
    ).scalar_one_or_none()
    if row is not None:
        await session.delete(row)
