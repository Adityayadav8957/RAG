"""Per-user Jira connection (OAuth 2.0 3LO)."""

from __future__ import annotations

import jwt
from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select

from app.agent import jira_auth
from app.api.schemas import IntegrationStatus
from app.db.models import IntegrationToken
from app.deps import PrincipalDep, ServicesDep, SessionDep
from app.observability.audit import audit

router = APIRouter(prefix="/v1/integrations/jira", tags=["integrations"])


@router.get("", response_model=IntegrationStatus)
async def jira_status(
    principal: PrincipalDep, services: ServicesDep, session: SessionDep
) -> IntegrationStatus:
    row = (
        await session.execute(
            select(IntegrationToken).where(
                IntegrationToken.user_id == principal.user_id, IntegrationToken.provider == jira_auth.PROVIDER
            )
        )
    ).scalar_one_or_none()
    configured = bool(services.settings.jira_oauth_client_id and services.settings.jira_oauth_client_secret)
    return IntegrationStatus(
        connected=row is not None, site_url=(row.meta.get("site_url") if row else None), configured=configured
    )


@router.post("/connect")
async def jira_connect(principal: PrincipalDep, services: ServicesDep) -> dict[str, str]:
    if not services.settings.jira_oauth_client_id:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Jira integration is not configured")
    return {"url": jira_auth.authorize_url(principal.user_id, services.settings)}


@router.get("/callback", include_in_schema=False)
async def jira_callback(
    services: ServicesDep, session: SessionDep, code: str = Query(...), state: str = Query(...)
) -> RedirectResponse:
    target = f"{services.settings.frontend_origin.rstrip('/')}/settings"
    try:
        user_id = jira_auth.read_state(state, services.settings)
        meta = await jira_auth.complete_connect(session, user_id, code, services.settings, services.cipher)
        await session.commit()
    except (jwt.PyJWTError, jira_auth.JiraNotConnected, ValueError):
        return RedirectResponse(f"{target}?jira=error", status_code=302)
    await audit("integration.jira_connected", actor_id=user_id, details={"site": meta.get("site_url")})
    return RedirectResponse(f"{target}?jira=connected", status_code=302)


@router.delete("", status_code=204)
async def jira_disconnect(principal: PrincipalDep, session: SessionDep) -> None:
    await jira_auth.disconnect(session, principal.user_id)
    await session.commit()
    await audit("integration.jira_disconnected", actor_id=principal.user_id)
