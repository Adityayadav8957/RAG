"""Document upload and access-control management."""

from __future__ import annotations

import uuid

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
    status,
)
from sqlalchemy import select

from app.api.schemas import AclIn, DocumentOut
from app.db.models import Document, User
from app.deps import PrincipalDep, ServicesDep, SessionDep, require_roles
from app.observability.audit import audit
from app.rag.ingest import process_document, sha256_hex
from app.rag.parsing import UnsupportedDocument, detect_kind
from app.rag.retrieval import doc_acl
from app.security.rbac import KNOWN_ROLES, Principal, can_read_document

router = APIRouter(prefix="/v1/documents", tags=["documents"])

_UPLOADERS = Depends(require_roles("hr", "manager"))


async def _resolve_users(session: SessionDep, tenant: str, emails: list[str]) -> list[uuid.UUID]:
    if not emails:
        return []
    wanted = {e.strip().lower() for e in emails if e.strip()}
    rows = (
        (await session.execute(select(User).where(User.email.in_(wanted), User.tenant == tenant)))
        .scalars()
        .all()
    )
    missing = wanted - {u.email for u in rows}
    if missing:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown users: {sorted(missing)}")
    return [u.id for u in rows]


def _validate_roles(roles: list[str]) -> list[str]:
    unknown = set(roles) - KNOWN_ROLES
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown roles: {sorted(unknown)}")
    return sorted(set(roles))


@router.post("", response_model=DocumentOut, status_code=202)
async def upload_document(
    background: BackgroundTasks,
    principal: Principal = _UPLOADERS,
    services: ServicesDep = None,  # type: ignore[assignment]
    session: SessionDep = None,  # type: ignore[assignment]
    file: UploadFile = File(...),
    visibility: str = Form("restricted", pattern="^(all|restricted)$"),
    allowed_roles: str = Form(""),
    allowed_user_emails: str = Form(""),
) -> Document:
    settings = services.settings
    data = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"File exceeds {settings.max_upload_mb} MB"
        )
    if not data:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Empty file")
    filename = (file.filename or "document")[:300]
    try:
        kind = detect_kind(filename, file.content_type or "")
    except UnsupportedDocument as exc:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, str(exc)) from exc

    roles = _validate_roles([r.strip() for r in allowed_roles.split(",") if r.strip()])
    user_ids = await _resolve_users(session, principal.tenant, allowed_user_emails.split(","))
    digest = sha256_hex(data)
    duplicate = (
        await session.execute(
            select(Document.id).where(
                Document.sha256 == digest, Document.owner_id == principal.user_id, Document.status != "failed"
            )
        )
    ).first()
    if duplicate:
        raise HTTPException(status.HTTP_409_CONFLICT, "You already uploaded this file")

    doc = Document(
        title=filename.rsplit(".", 1)[0],
        filename=filename,
        content_type=file.content_type or kind,
        sha256=digest,
        owner_id=principal.user_id,
        tenant=principal.tenant,
        visibility=visibility,
        allowed_roles=roles,
        allowed_user_ids=user_ids,
    )
    session.add(doc)
    await session.commit()
    await audit(
        "document.uploaded",
        actor_id=principal.user_id,
        resource=f"document:{doc.id}",
        details={
            "filename": filename,
            "visibility": visibility,
            "roles": roles,
            "users": [str(u) for u in user_ids],
        },
    )
    background.add_task(
        process_document,
        document_id=doc.id,
        data=data,
        kind=kind,
        llm=services.llm,
        index=services.chunk_index,
        settings=settings,
    )
    return doc


@router.get("", response_model=list[DocumentOut])
async def list_documents(principal: PrincipalDep, session: SessionDep) -> list[Document]:
    rows = (
        (
            await session.execute(
                select(Document)
                .where(Document.tenant == principal.tenant)
                .order_by(Document.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [d for d in rows if can_read_document(principal, doc_acl(d))]


async def _manageable(session: SessionDep, principal: Principal, document_id: uuid.UUID) -> Document:
    doc = (await session.execute(select(Document).where(Document.id == document_id))).scalar_one_or_none()
    # Hide existence from people who cannot read the document at all.
    if doc is None or not can_read_document(principal, doc_acl(doc)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    if not (principal.is_admin or doc.owner_id == principal.user_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner or an admin can change this document")
    return doc


@router.put("/{document_id}/acl", response_model=DocumentOut)
async def update_acl(
    document_id: uuid.UUID, body: AclIn, principal: PrincipalDep, services: ServicesDep, session: SessionDep
) -> Document:
    doc = await _manageable(session, principal, document_id)
    doc.visibility = body.visibility
    doc.allowed_roles = _validate_roles(body.allowed_roles)
    doc.allowed_user_ids = await _resolve_users(session, principal.tenant, body.allowed_user_emails)
    await session.commit()
    # Access lives in SQL next to the vectors; only cached answers built from it need dropping.
    await services.cache_index.purge_document(doc.id)
    await audit(
        "document.acl_changed",
        actor_id=principal.user_id,
        resource=f"document:{doc.id}",
        details={"visibility": doc.visibility, "roles": doc.allowed_roles},
    )
    return doc


@router.delete("/{document_id}", status_code=204)
async def delete_document(
    document_id: uuid.UUID, principal: PrincipalDep, services: ServicesDep, session: SessionDep
) -> Response:
    doc = await _manageable(session, principal, document_id)
    await services.cache_index.purge_document(doc.id)
    await session.delete(doc)
    await session.commit()
    await audit("document.deleted", actor_id=principal.user_id, resource=f"document:{document_id}")
    return Response(status_code=204)
