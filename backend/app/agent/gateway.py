"""Tool gateway: policy authorization, user-scoped credentials, MCP calls, result validation."""

from __future__ import annotations

import time
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.agent import jira_auth
from app.agent.guardrails import sanitize_untrusted
from app.agent.mcp_client import McpClient, McpError, McpTool
from app.agent.policy import PolicyEngine, ToolPolicy
from app.config import Settings
from app.llm.client import ToolSpec
from app.logging import get_logger
from app.observability.metrics import TOOL_CALLS
from app.security.crypto import TokenCipher
from app.security.rbac import Principal

log = get_logger("gateway")

MAX_RESULT_CHARS = 12_000
_CATALOG_TTL = 300.0


class ToolDenied(Exception):
    pass


class ToolGateway:
    def __init__(self, settings: Settings, policy: PolicyEngine, mcp: McpClient, cipher: TokenCipher) -> None:
        self._settings = settings
        self._policy = policy
        self._mcp = mcp
        self._cipher = cipher
        self._catalog: list[McpTool] = []
        self._catalog_at = 0.0

    async def _tools(self) -> list[McpTool]:
        if self._catalog and time.monotonic() - self._catalog_at < _CATALOG_TTL:
            return self._catalog
        try:
            self._catalog = await self._mcp.list_tools()
            self._catalog_at = time.monotonic()
        except McpError:
            log.warning("mcp_catalog_unavailable")
            return self._catalog  # stale catalog is better than none; empty on first failure
        return self._catalog

    async def specs_for(self, principal: Principal) -> list[ToolSpec]:
        specs: list[ToolSpec] = []
        for tool in await self._tools():
            decision, _ = self._policy.authorize_tool(principal, tool.name)
            if decision.allowed:
                specs.append(ToolSpec(tool.name, tool.description, tool.input_schema))
        return specs

    def authorize(self, principal: Principal, name: str) -> ToolPolicy:
        decision, policy = self._policy.authorize_tool(principal, name)
        if not decision.allowed or policy is None:
            TOOL_CALLS.labels(tool=name, outcome="denied").inc()
            raise ToolDenied(decision.reason)
        return policy

    async def execute(
        self, session: AsyncSession, principal: Principal, name: str, args: dict[str, Any]
    ) -> str:
        """Authorize again (never trust an earlier check), call the tool, validate the result."""
        self.authorize(principal, name)
        try:
            token, cloud_id = await jira_auth.get_access(
                session, principal.user_id, self._settings, self._cipher
            )
        except jira_auth.JiraNotConnected as exc:
            TOOL_CALLS.labels(tool=name, outcome="not_connected").inc()
            return f"ERROR: {exc}. Tell the user to connect Jira from the Integrations page."
        try:
            raw = await self._mcp.call_tool(
                name,
                args,
                {"Authorization": f"Bearer {token}", "X-Atlassian-Cloud-Id": cloud_id},
            )
        except McpError as exc:
            TOOL_CALLS.labels(tool=name, outcome="error").inc()
            return f"ERROR: {exc}"
        TOOL_CALLS.labels(tool=name, outcome="ok").inc()
        return self._validate_result(name, raw)

    def _validate_result(self, name: str, raw: str) -> str:
        text = raw if len(raw) <= MAX_RESULT_CHARS else raw[:MAX_RESULT_CHARS] + "\n…[truncated]"
        fenced, _score = sanitize_untrusted(f"TOOL RESULT {name}", text, self._settings)
        if fenced is None:
            return "ERROR: The tool result was withheld because it contained instructions aimed at the assistant."
        return fenced


def describe_action(name: str, args: dict[str, Any]) -> str:
    """Human-readable summary shown in the approval prompt."""

    def short(v: Any) -> str:
        s = str(v)
        return s if len(s) <= 200 else s[:200] + "…"

    if name == "jira_create_issue":
        return f"Create a Jira {args.get('issue_type', 'Task')} in project {args.get('project_key')}: {short(args.get('summary'))}"
    if name == "jira_add_comment":
        return f"Add a comment to {args.get('issue_key')}: {short(args.get('comment'))}"
    if name == "jira_transition_issue":
        return f"Move {args.get('issue_key')} to '{args.get('transition')}'"
    return f"Run {name} with {short(args)}"
