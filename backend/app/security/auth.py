"""Google ID-token verification and application session tokens."""

from __future__ import annotations

import asyncio
import hashlib
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db.models import Invitation, User

_ISSUER = "enterprise-ai-assistant"
_ALGORITHM = "HS256"


class AuthError(Exception):
    """Raised for any authentication failure; message is safe to show to the client."""


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str
    email: str
    name: str
    hd: str = ""


def _verify_google_token_sync(token: str, client_id: str) -> dict[str, Any]:
    return google_id_token.verify_oauth2_token(  # type: ignore[no-untyped-call,no-any-return]
        token, google_requests.Request(), client_id
    )


async def verify_google_id_token(token: str, settings: Settings) -> GoogleIdentity:
    if not settings.google_client_id:
        raise AuthError("Google sign-in is not configured")
    try:
        claims = await asyncio.to_thread(_verify_google_token_sync, token, settings.google_client_id)
    except ValueError as exc:
        raise AuthError("Invalid Google credential") from exc

    email = str(claims.get("email", "")).lower()
    if not email or not claims.get("email_verified"):
        raise AuthError("Google account email is not verified")
    return GoogleIdentity(
        sub=str(claims["sub"]),
        email=email,
        name=str(claims.get("name", "")),
        hd=str(claims.get("hd", "")).lower(),
    )


# Consumer mail providers: owning one of these addresses says nothing about an organisation.
PUBLIC_EMAIL_DOMAINS = frozenset(
    {
        "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
        "yahoo.com", "yahoo.co.in", "icloud.com", "me.com", "aol.com", "proton.me",
        "protonmail.com", "rediffmail.com",
    }
)  # fmt: skip


def personal_tenant(sub: str) -> str:
    """Workspace id for someone who has no company domain: private to them (and their invitees)."""
    return "p-" + hashlib.md5(sub.encode(), usedforsecurity=False).hexdigest()[:12]


async def ensure_access(
    session: AsyncSession, identity: GoogleIdentity, settings: Settings
) -> Invitation | None:
    """Decide whether this Google identity may sign in; return its invitation, if any.

    ``open`` signup admits everyone. ``restricted`` admits invited emails, ``ADMIN_EMAILS`` and
    ``ALLOWED_EMAIL_DOMAINS`` only.
    """
    invitation = (
        await session.execute(select(Invitation).where(Invitation.email == identity.email))
    ).scalar_one_or_none()
    if settings.signup_mode == "open" or invitation is not None or identity.email in settings.admin_emails:
        return invitation
    domain = identity.email.rsplit("@", 1)[-1]
    allowed = settings.allowed_email_domains
    if not allowed or domain not in allowed:
        raise AuthError(
            f"{identity.email} is not allowed to use this application. "
            "Ask an administrator to invite you, or sign in with a company account."
        )
    if identity.hd and identity.hd not in allowed:
        raise AuthError("Your organization is not allowed to use this application")
    return None


def _tenant_for(identity: GoogleIdentity, settings: Settings, invitation: Invitation | None) -> str:
    """Which workspace a brand-new user lands in.

    Invited people join the inviter's workspace. A verified company domain (Google Workspace
    ``hd`` claim, or an allowlisted domain) shares one workspace. Everyone else gets a private
    personal workspace.
    """
    if invitation is not None and invitation.tenant:
        return invitation.tenant
    domain = identity.email.rsplit("@", 1)[-1]
    if domain not in PUBLIC_EMAIL_DOMAINS and (
        identity.hd == domain or domain in settings.allowed_email_domains
    ):
        return domain
    return personal_tenant(identity.sub)


async def upsert_user(
    session: AsyncSession,
    identity: GoogleIdentity,
    settings: Settings,
    invitation: Invitation | None = None,
) -> User:
    result = await session.execute(select(User).where(User.google_sub == identity.sub))
    user = result.scalar_one_or_none()
    if user is None:
        result = await session.execute(select(User).where(User.email == identity.email))
        user = result.scalar_one_or_none()
    is_admin = identity.email in settings.admin_emails
    if user is None:
        tenant = _tenant_for(identity, settings, invitation)
        roles = list(invitation.roles) if invitation is not None else ["employee"]
        if invitation is None:
            # The first person in a workspace administers it, so nobody has to be set up by hand.
            taken = (await session.execute(select(User.id).where(User.tenant == tenant).limit(1))).first()
            is_admin = is_admin or taken is None
        if is_admin and "admin" not in roles:
            roles.append("admin")
        user = User(
            email=identity.email,
            name=identity.name,
            google_sub=identity.sub,
            tenant=tenant,
            roles=sorted(set(roles)),
        )
        session.add(user)
    else:
        user.google_sub = identity.sub
        user.name = identity.name or user.name
        if is_admin and "admin" not in user.roles:
            user.roles = [*user.roles, "admin"]
    if invitation is not None and invitation.accepted_at is None:
        invitation.accepted_at = datetime.now(UTC)
    user.last_login_at = datetime.now(UTC)
    await session.flush()
    return user


def issue_session_token(user: User, settings: Settings) -> tuple[str, int]:
    ttl = timedelta(minutes=settings.session_ttl_minutes)
    now = datetime.now(UTC)
    payload = {
        "iss": _ISSUER,
        "sub": str(user.id),
        "iat": now,
        "exp": now + ttl,
        "jti": uuid.uuid4().hex,
    }
    token = jwt.encode(payload, settings.session_secret.get_secret_value(), algorithm=_ALGORITHM)
    return token, int(ttl.total_seconds())


def decode_session_token(token: str, settings: Settings) -> uuid.UUID:
    try:
        payload = jwt.decode(
            token,
            settings.session_secret.get_secret_value(),
            algorithms=[_ALGORITHM],
            issuer=_ISSUER,
            options={"require": ["exp", "iat", "sub", "iss"]},
        )
        return uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, ValueError) as exc:
        raise AuthError("Invalid or expired session") from exc
