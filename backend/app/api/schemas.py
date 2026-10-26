from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    email: str
    name: str
    roles: list[str]


class InvitationIn(BaseModel):
    email: str = Field(min_length=3, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    roles: list[str] = Field(default_factory=lambda: ["employee"], min_length=1)


class InvitationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    email: str
    roles: list[str]
    created_at: datetime
    accepted_at: datetime | None = None


class GoogleLoginIn(BaseModel):
    credential: str = Field(min_length=20, max_length=4096)


class SessionOut(BaseModel):
    access_token: str
    expires_in: int
    user: UserOut


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    title: str
    updated_at: datetime


class MessageOut(BaseModel):
    id: uuid.UUID
    role: str
    text: str
    citations: list[dict[str, Any]] = []
    trace: list[dict[str, Any]] = []
    cached: bool = False
    created_at: datetime


class ChatIn(BaseModel):
    text: str = Field(min_length=1, max_length=20000)


class ApprovalIn(BaseModel):
    approve: bool


class PendingActionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    tool: str
    summary: str
    arguments: dict[str, Any]
    expires_at: datetime


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    title: str
    filename: str
    status: str
    error: str | None
    visibility: str
    allowed_roles: list[str]
    chunk_count: int
    created_at: datetime
    owner_id: uuid.UUID


class AclIn(BaseModel):
    visibility: str = Field(pattern="^(all|restricted)$")
    allowed_roles: list[str] = []
    allowed_user_emails: list[str] = []


class RolesIn(BaseModel):
    roles: list[str] = Field(min_length=1)


class IntegrationStatus(BaseModel):
    connected: bool
    site_url: str | None = None
    configured: bool
