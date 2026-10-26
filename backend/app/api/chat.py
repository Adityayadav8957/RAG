"""Conversations, chat (Server-Sent Events) and action approvals."""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.agent.orchestrator import ActionNotFound, ConversationNotFound, Orchestrator
from app.api.schemas import (
    ApprovalIn,
    ChatIn,
    ConversationOut,
    MessageOut,
    PendingActionOut,
)
from app.db.models import Conversation, Message, PendingAction
from app.deps import PrincipalDep, ServicesDep, SessionDep, enforce_quota
from app.logging import get_logger
from app.observability.audit import audit

log = get_logger("api.chat")
router = APIRouter(prefix="/v1", tags=["chat"])

_SSE_HEADERS = {"Cache-Control": "no-store", "X-Accel-Buffering": "no", "Connection": "keep-alive"}


def _sse(event: dict[str, Any]) -> bytes:
    return f"event: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n".encode()


async def _stream(events: AsyncIterator[dict[str, Any]]) -> AsyncIterator[bytes]:
    try:
        async for event in events:
            yield _sse(event)
    except (ConversationNotFound, ActionNotFound):
        yield _sse({"type": "error", "message": "Not found"})
    except Exception:  # noqa: BLE001 - never leak internals to the client
        log.error("chat_stream_failed", exc_info=True)
        yield _sse({"type": "error", "message": "Something went wrong. Please try again."})


@router.post("/conversations", response_model=ConversationOut, status_code=201)
async def create_conversation(principal: PrincipalDep, session: SessionDep) -> Conversation:
    conv = Conversation(user_id=principal.user_id)
    session.add(conv)
    await session.commit()
    return conv


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(principal: PrincipalDep, session: SessionDep) -> list[Conversation]:
    rows = await session.execute(
        select(Conversation)
        .where(Conversation.user_id == principal.user_id)
        .order_by(Conversation.updated_at.desc())
        .limit(100)
    )
    return list(rows.scalars().all())


async def _owned(session: SessionDep, principal: PrincipalDep, conversation_id: uuid.UUID) -> Conversation:
    conv = (
        await session.execute(
            select(Conversation).where(
                Conversation.id == conversation_id, Conversation.user_id == principal.user_id
            )
        )
    ).scalar_one_or_none()
    if conv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    return conv


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
async def list_messages(
    conversation_id: uuid.UUID, principal: PrincipalDep, session: SessionDep
) -> list[MessageOut]:
    await _owned(session, principal, conversation_id)
    rows = (
        (
            await session.execute(
                select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at)
            )
        )
        .scalars()
        .all()
    )
    # Tool plumbing messages are internal; users only see their turns and final answers.
    return [
        MessageOut(
            id=m.id,
            role=m.role,
            text=m.text,
            citations=(m.data or {}).get("citations", []),
            trace=(m.data or {}).get("trace", []),
            cached=bool((m.data or {}).get("cached", False)),
            created_at=m.created_at,
        )
        for m in rows
        if m.role == "user" or (m.role == "assistant" and not (m.data or {}).get("tool_calls"))
    ]


@router.delete("/conversations/{conversation_id}", status_code=204)
async def delete_conversation(
    conversation_id: uuid.UUID, principal: PrincipalDep, session: SessionDep
) -> Response:
    conv = await _owned(session, principal, conversation_id)
    await session.delete(conv)
    await session.commit()
    await audit(
        "conversation.deleted", actor_id=principal.user_id, resource=f"conversation:{conversation_id}"
    )
    return Response(status_code=204)


@router.get("/conversations/{conversation_id}/pending", response_model=list[PendingActionOut])
async def pending_actions(
    conversation_id: uuid.UUID, principal: PrincipalDep, session: SessionDep
) -> list[PendingAction]:
    await _owned(session, principal, conversation_id)
    rows = await session.execute(
        select(PendingAction).where(
            PendingAction.conversation_id == conversation_id,
            PendingAction.status == "pending",
            PendingAction.expires_at > datetime.now(UTC),
        )
    )
    return list(rows.scalars().all())


@router.post("/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: uuid.UUID,
    body: ChatIn,
    principal: PrincipalDep,
    services: ServicesDep,
    session: SessionDep,
) -> StreamingResponse:
    await _owned(session, principal, conversation_id)
    await enforce_quota(services.settings, session, principal)
    events = Orchestrator(services).chat(principal, conversation_id, body.text)
    return StreamingResponse(_stream(events), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.post("/approvals/{action_id}")
async def decide_action(
    action_id: uuid.UUID,
    body: ApprovalIn,
    principal: PrincipalDep,
    services: ServicesDep,
    session: SessionDep,
) -> StreamingResponse:
    # Validate up-front so the client gets a proper 404/409 instead of an in-stream error.
    action = (
        await session.execute(
            select(PendingAction).where(
                PendingAction.id == action_id, PendingAction.user_id == principal.user_id
            )
        )
    ).scalar_one_or_none()
    if action is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Action not found")
    if action.status != "pending" or action.expires_at <= datetime.now(UTC):
        raise HTTPException(status.HTTP_409_CONFLICT, "This action can no longer be approved")
    events = Orchestrator(services).resume(principal, action_id, body.approve)
    return StreamingResponse(_stream(events), media_type="text/event-stream", headers=_SSE_HEADERS)
