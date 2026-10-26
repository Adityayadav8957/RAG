"""Policy evaluation: request screening and tool authorization (fail closed)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from app.security.rbac import Principal


@dataclass(frozen=True)
class PolicyDecision:
    allowed: bool
    reason: str = ""
    rule_id: str = ""


@dataclass(frozen=True)
class ToolPolicy:
    name: str
    access: str  # read | write
    roles: frozenset[str]
    approval: bool


class PolicyEngine:
    def __init__(self, config: dict[str, Any]) -> None:
        self._blocked_requests = [
            (r["id"], re.compile(r["pattern"]), r["reason"]) for r in config.get("blocked_requests", [])
        ]
        self._blocked_output = [
            (r["id"], re.compile(r["pattern"]), r["reason"]) for r in config.get("blocked_output", [])
        ]
        self._tools: dict[str, ToolPolicy] = {}
        for name, spec in (config.get("tools") or {}).items():
            access = spec.get("access", "write")
            self._tools[name] = ToolPolicy(
                name=name,
                access=access,
                roles=frozenset(spec.get("roles", [])),
                # Writes always require approval unless explicitly (and deliberately) disabled.
                approval=bool(spec.get("approval", access != "read")),
            )

    @classmethod
    def from_file(cls, path: str) -> PolicyEngine:
        with Path(path).open(encoding="utf-8") as fh:
            return cls(yaml.safe_load(fh) or {})

    def check_request(self, text: str) -> PolicyDecision:
        for rule_id, pattern, reason in self._blocked_requests:
            if pattern.search(text):
                return PolicyDecision(False, reason, rule_id)
        return PolicyDecision(True)

    def check_output(self, text: str) -> PolicyDecision:
        for rule_id, pattern, reason in self._blocked_output:
            if pattern.search(text):
                return PolicyDecision(False, reason, rule_id)
        return PolicyDecision(True)

    def tool_policy(self, name: str) -> ToolPolicy | None:
        return self._tools.get(name)

    def authorize_tool(self, principal: Principal, name: str) -> tuple[PolicyDecision, ToolPolicy | None]:
        policy = self._tools.get(name)
        if policy is None:
            return PolicyDecision(False, f"Tool '{name}' is not permitted by policy", "unknown_tool"), None
        if not principal.has_any_role(policy.roles):
            return PolicyDecision(False, f"Your role cannot use '{name}'", "role_denied"), policy
        return PolicyDecision(True), policy
