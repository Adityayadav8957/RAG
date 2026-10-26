from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.api.schemas import GoogleLoginIn, SessionOut, UserOut
from app.deps import PrincipalDep, ServicesDep, SessionDep
from app.observability.audit import audit
from app.security.auth import (
    AuthError,
    ensure_access,
    issue_session_token,
    upsert_user,
    verify_google_id_token,
)

router = APIRouter(prefix="/v1", tags=["auth"])


@router.post("/auth/google", response_model=SessionOut)
async def login_with_google(body: GoogleLoginIn, services: ServicesDep, session: SessionDep) -> SessionOut:
    try:
        identity = await verify_google_id_token(body.credential, services.settings)
        invitation = await ensure_access(session, identity, services.settings)
    except AuthError as exc:
        await audit("auth.login_failed", actor_id=None, details={"reason": str(exc)})
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc
    user = await upsert_user(session, identity, services.settings, invitation)
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")
    await session.commit()
    token, ttl = issue_session_token(user, services.settings)
    await audit("auth.login", actor_id=user.id, details={"email": user.email})
    return SessionOut(access_token=token, expires_in=ttl, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
async def me(principal: PrincipalDep) -> UserOut:
    return UserOut(
        id=principal.user_id, email=principal.email, name=principal.name, roles=sorted(principal.roles)
    )
