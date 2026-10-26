"""Administration: users, roles, audit trail."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select

from app.api.schemas import InvitationIn, InvitationOut, RolesIn, UserOut
from app.db.models import AuditLog, Invitation, User
from app.deps import SessionDep, require_roles
from app.observability.audit import audit
from app.security.rbac import Principal, validate_roles

router = APIRouter(prefix="/v1/admin", tags=["admin"], dependencies=[Depends(require_roles("admin"))])
_ADMIN = Depends(require_roles("admin"))


@router.get("/users", response_model=list[UserOut])
async def list_users(session: SessionDep, admin: Principal = _ADMIN) -> list[User]:
    stmt = select(User).where(User.tenant == admin.tenant).order_by(User.email)
    return list((await session.execute(stmt)).scalars().all())


@router.get("/invitations", response_model=list[InvitationOut])
async def list_invitations(session: SessionDep, admin: Principal = _ADMIN) -> list[Invitation]:
    rows = await session.execute(
        select(Invitation).where(Invitation.tenant == admin.tenant).order_by(Invitation.created_at.desc())
    )
    return list(rows.scalars().all())


@router.post("/invitations", response_model=InvitationOut, status_code=status.HTTP_201_CREATED)
async def invite_user(body: InvitationIn, session: SessionDep, admin: Principal = _ADMIN) -> Invitation:
    """Pre-approve an email. The person signs in with Google and lands with these roles."""
    try:
        roles = validate_roles(body.roles)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    email = body.email.strip().lower()
    if (await session.execute(select(User.id).where(User.email == email))).first():
        raise HTTPException(
            status.HTTP_409_CONFLICT, "That person already has an account. Change their roles in the list."
        )
    invitation = (
        await session.execute(select(Invitation).where(Invitation.email == email))
    ).scalar_one_or_none()
    if invitation is not None and invitation.tenant != admin.tenant:
        raise HTTPException(status.HTTP_409_CONFLICT, "That email has already been invited elsewhere")
    if invitation is None:
        invitation = Invitation(email=email, roles=roles, tenant=admin.tenant, invited_by=admin.user_id)
        session.add(invitation)
    else:
        invitation.roles = roles
    await session.commit()
    await audit(
        "admin.user_invited",
        actor_id=admin.user_id,
        resource=f"invitation:{invitation.id}",
        details={"email": email, "roles": roles},
    )
    return invitation


@router.delete("/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invitation(invitation_id: uuid.UUID, session: SessionDep, admin: Principal = _ADMIN) -> None:
    invitation = (
        await session.execute(
            select(Invitation).where(Invitation.id == invitation_id, Invitation.tenant == admin.tenant)
        )
    ).scalar_one_or_none()
    if invitation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation not found")
    await session.delete(invitation)
    await session.commit()
    await audit(
        "admin.invitation_revoked",
        actor_id=admin.user_id,
        resource=f"invitation:{invitation_id}",
        details={"email": invitation.email},
    )


@router.put("/users/{user_id}/roles", response_model=UserOut)
async def set_roles(
    user_id: uuid.UUID, body: RolesIn, session: SessionDep, admin: Principal = _ADMIN
) -> User:
    try:
        roles = validate_roles(body.roles)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    user = (
        await session.execute(select(User).where(User.id == user_id, User.tenant == admin.tenant))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if user.id == admin.user_id and "admin" not in roles:
        raise HTTPException(status.HTTP_409_CONFLICT, "You cannot remove your own admin role")
    before = list(user.roles)
    user.roles = roles
    await session.commit()
    await audit(
        "admin.roles_changed",
        actor_id=admin.user_id,
        resource=f"user:{user.id}",
        details={"before": before, "after": roles},
    )
    return user


@router.put("/users/{user_id}/active", response_model=UserOut)
async def set_active(
    user_id: uuid.UUID, active: bool, session: SessionDep, admin: Principal = _ADMIN
) -> User:
    user = (
        await session.execute(select(User).where(User.id == user_id, User.tenant == admin.tenant))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if user.id == admin.user_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "You cannot deactivate yourself")
    user.is_active = active
    await session.commit()
    await audit(
        "admin.user_active_changed",
        actor_id=admin.user_id,
        resource=f"user:{user.id}",
        details={"active": active},
    )
    return user


@router.get("/audit")
async def audit_log(
    session: SessionDep,
    admin: Principal = _ADMIN,
    event: str | None = None,
    actor_id: uuid.UUID | None = None,
    limit: int = Query(100, ge=1, le=500),
    before_id: int | None = None,
) -> list[dict[str, Any]]:
    members = select(User.id).where(User.tenant == admin.tenant)
    stmt = select(AuditLog).where(AuditLog.actor_id.in_(members)).order_by(AuditLog.id.desc()).limit(limit)
    if event:
        stmt = stmt.where(AuditLog.event == event)
    if actor_id:
        stmt = stmt.where(AuditLog.actor_id == actor_id)
    if before_id:
        stmt = stmt.where(AuditLog.id < before_id)
    rows = (await session.execute(stmt)).scalars().all()
    return [
        {
            "id": r.id,
            "ts": r.ts.isoformat(),
            "actor_id": str(r.actor_id) if r.actor_id else None,
            "event": r.event,
            "resource": r.resource,
            "request_id": r.request_id,
            "details": r.details,
        }
        for r in rows
    ]
