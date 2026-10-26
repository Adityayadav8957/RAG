"""Role model and document-level access control.

The same predicate is expressed twice: in Python (``can_read_document``) and as a SQL
clause. The Python version is authoritative and is applied again to
every retrieved chunk, so a mis-synced vector payload can never leak a document.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

ROLE_EMPLOYEE = "employee"
ROLE_MANAGER = "manager"
ROLE_HR = "hr"
ROLE_ADMIN = "admin"
KNOWN_ROLES = frozenset({ROLE_EMPLOYEE, ROLE_MANAGER, ROLE_HR, ROLE_ADMIN})


@dataclass(frozen=True)
class Principal:
    """The authenticated caller, as seen by every downstream component."""

    user_id: uuid.UUID
    email: str
    name: str
    roles: frozenset[str]
    tenant: str = field(default="")

    @property
    def is_admin(self) -> bool:
        return ROLE_ADMIN in self.roles

    def has_any_role(self, roles: list[str] | frozenset[str] | set[str]) -> bool:
        return bool(self.roles & set(roles))


@dataclass(frozen=True)
class DocumentAcl:
    owner_id: uuid.UUID
    visibility: str
    allowed_roles: frozenset[str]
    allowed_user_ids: frozenset[uuid.UUID]
    tenant: str = ""


def can_read_document(principal: Principal, acl: DocumentAcl) -> bool:
    if principal.tenant != acl.tenant:  # workspaces are hard walls, admins included
        return False
    if principal.is_admin or principal.user_id == acl.owner_id:
        return True
    if acl.visibility == "all":
        return True
    if principal.user_id in acl.allowed_user_ids:
        return True
    return bool(principal.roles & acl.allowed_roles)


def validate_roles(roles: list[str]) -> list[str]:
    unknown = set(roles) - KNOWN_ROLES
    if unknown:
        raise ValueError(f"Unknown roles: {sorted(unknown)}")
    return sorted(set(roles))
