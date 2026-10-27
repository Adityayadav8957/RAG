"""Jira MCP server (streamable HTTP).

Stateless and credential-less: every call carries the *calling employee's* Jira OAuth
access token and cloud id in request headers, supplied by the gateway. The server itself
holds no Jira secret, so it cannot act with more privilege than the user has.

Requests must also present the shared gateway secret; otherwise anyone who could reach this
service could forward arbitrary tokens through it.
"""

from __future__ import annotations

import hmac
import os
from typing import Any

import httpx
from mcp.server.fastmcp import Context, FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

GATEWAY_SECRET = os.environ.get("MCP_SHARED_SECRET", "dev-only-mcp-secret")
API_ROOT = "https://api.atlassian.com/ex/jira"
TIMEOUT = httpx.Timeout(20.0)

# Public hostname behind a proxy: the default localhost-only Host check would answer 421. Access is
# gated by the gateway secret below, and DNS rebinding only matters for servers bound to localhost.
mcp = FastMCP(
    "jira",
    stateless_http=True,
    json_response=True,
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)


class JiraApiError(Exception):
    pass


def _creds(ctx: Context[Any, Any, Any]) -> tuple[str, str]:
    request = ctx.request_context.request
    assert request is not None
    auth = request.headers.get("authorization", "")
    cloud_id = request.headers.get("x-atlassian-cloud-id", "")
    if not auth.lower().startswith("bearer ") or not cloud_id:
        raise JiraApiError("Missing Jira credentials")
    return auth[7:], cloud_id


async def _jira(ctx: Context[Any, Any, Any], method: str, path: str, **kwargs: Any) -> Any:
    token, cloud_id = _creds(ctx)
    url = f"{API_ROOT}/{cloud_id}/rest/api/3{path}"
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.request(
            method, url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"}, **kwargs
        )
    if resp.status_code == 401:
        if "scope" in resp.text.lower():
            raise JiraApiError(
                "The Jira connection lacks a permission this action needs. "
                "Disconnect and reconnect Jira (and make sure the Atlassian app has the scope)."
            )
        raise JiraApiError("Jira rejected the credentials (expired or revoked)")
    if resp.status_code == 403:
        raise JiraApiError("You do not have permission to do that in Jira")
    if resp.status_code == 404:
        raise JiraApiError("Not found in Jira (or you cannot see it)")
    if resp.status_code >= 400:
        raise JiraApiError(f"Jira error {resp.status_code}: {resp.text[:300]}")
    return resp.json() if resp.content else {}


def _adf(text: str) -> dict[str, Any]:
    """Wrap plain text in Atlassian Document Format."""
    paragraphs = [p for p in text.split("\n\n") if p.strip()] or [text]
    return {
        "type": "doc",
        "version": 1,
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": p}]} for p in paragraphs],
    }


def _adf_to_text(node: Any) -> str:
    if isinstance(node, dict):
        if node.get("type") == "text":
            return str(node.get("text", ""))
        inner = "".join(_adf_to_text(c) for c in node.get("content", []))
        return inner + ("\n" if node.get("type") in ("paragraph", "heading") else "")
    if isinstance(node, list):
        return "".join(_adf_to_text(c) for c in node)
    return ""


def _issue_summary(issue: dict[str, Any]) -> dict[str, Any]:
    f = issue.get("fields", {})
    return {
        "key": issue.get("key"),
        "summary": f.get("summary"),
        "status": (f.get("status") or {}).get("name"),
        "assignee": (f.get("assignee") or {}).get("displayName"),
        "priority": (f.get("priority") or {}).get("name"),
        "type": (f.get("issuetype") or {}).get("name"),
    }


@mcp.tool()
async def jira_search_issues(jql: str, ctx: Context[Any, Any, Any], max_results: int = 10) -> dict[str, Any]:
    """Search Jira issues with a JQL query (e.g. 'assignee = currentUser() AND resolution = Unresolved')."""
    data = await _jira(
        ctx,
        "POST",
        "/search/jql",
        json={
            "jql": jql,
            "maxResults": min(max(max_results, 1), 25),
            "fields": ["summary", "status", "assignee", "priority", "issuetype"],
        },
    )
    return {"issues": [_issue_summary(i) for i in data.get("issues", [])]}


@mcp.tool()
async def jira_get_issue(issue_key: str, ctx: Context[Any, Any, Any]) -> dict[str, Any]:
    """Get one issue by key (e.g. PROJ-123) including its description and recent comments."""
    data = await _jira(
        ctx,
        "GET",
        f"/issue/{issue_key}",
        params={"fields": "summary,status,assignee,priority,issuetype,description,comment"},
    )
    f = data.get("fields", {})
    comments = (f.get("comment") or {}).get("comments", [])[-5:]
    return {
        **_issue_summary(data),
        "description": _adf_to_text(f.get("description")).strip(),
        "recent_comments": [
            {
                "author": (c.get("author") or {}).get("displayName"),
                "body": _adf_to_text(c.get("body")).strip(),
            }
            for c in comments
        ],
    }


@mcp.tool()
async def jira_create_issue(
    project_key: str,
    summary: str,
    ctx: Context[Any, Any, Any],
    description: str = "",
    issue_type: str = "Task",
) -> dict[str, Any]:
    """Create a Jira issue. Requires user approval."""
    fields: dict[str, Any] = {
        "project": {"key": project_key},
        "summary": summary,
        "issuetype": {"name": issue_type},
    }
    if description:
        fields["description"] = _adf(description)
    data = await _jira(ctx, "POST", "/issue", json={"fields": fields})
    return {"key": data.get("key"), "id": data.get("id")}


@mcp.tool()
async def jira_create_project(
    key: str, name: str, ctx: Context[Any, Any, Any], description: str = "", template: str = "kanban"
) -> dict[str, Any]:
    """Create a Jira software project; the caller becomes its lead. Template is 'kanban' or 'scrum'.
    Needs Jira admin rights. Requires user approval."""
    templates = {
        "kanban": "com.pyxis.greenhopper.jira:gh-simplified-kanban-classic",
        "scrum": "com.pyxis.greenhopper.jira:gh-simplified-scrum-classic",
    }
    if template.lower() not in templates:
        raise JiraApiError("Template must be 'kanban' or 'scrum'")
    key = key.strip().upper()
    if not (2 <= len(key) <= 10 and key.isalpha()):
        raise JiraApiError("Project key must be 2-10 letters")
    me = await _jira(ctx, "GET", "/myself")
    body: dict[str, Any] = {
        "key": key,
        "name": name,
        "projectTypeKey": "software",
        "projectTemplateKey": templates[template.lower()],
        "leadAccountId": me["accountId"],
    }
    if description:
        body["description"] = description
    data = await _jira(ctx, "POST", "/project", json=body)
    return {"key": data.get("key"), "id": data.get("id")}


@mcp.tool()
async def jira_add_comment(issue_key: str, comment: str, ctx: Context[Any, Any, Any]) -> dict[str, Any]:
    """Add a comment to an issue. Requires user approval."""
    data = await _jira(ctx, "POST", f"/issue/{issue_key}/comment", json={"body": _adf(comment)})
    return {"id": data.get("id"), "issue": issue_key}


@mcp.tool()
async def jira_transition_issue(
    issue_key: str, transition: str, ctx: Context[Any, Any, Any]
) -> dict[str, Any]:
    """Move an issue to another status by transition name (e.g. 'In Progress', 'Done'). Requires user approval."""
    data = await _jira(ctx, "GET", f"/issue/{issue_key}/transitions")
    wanted = transition.strip().lower()
    match = next(
        (
            t
            for t in data.get("transitions", [])
            if t["name"].lower() == wanted or (t.get("to") or {}).get("name", "").lower() == wanted
        ),
        None,
    )
    if match is None:
        names = [t["name"] for t in data.get("transitions", [])]
        raise JiraApiError(f"No transition '{transition}'. Available: {names}")
    await _jira(ctx, "POST", f"/issue/{issue_key}/transitions", json={"transition": {"id": match["id"]}})
    return {"issue": issue_key, "transitioned_to": match["name"]}


class GatewaySecretMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        if request.url.path == "/healthz":
            return JSONResponse({"status": "ok"})
        supplied = request.headers.get("x-mcp-gateway-secret", "")
        if not hmac.compare_digest(supplied.encode(), GATEWAY_SECRET.encode()):
            return Response("Forbidden", status_code=403)
        return await call_next(request)


def create_app() -> Starlette:
    app = mcp.streamable_http_app()
    app.add_middleware(GatewaySecretMiddleware)
    return app


app = create_app()
