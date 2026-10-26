"""Evaluation harness and release gate.

    python -m evals.run --mode fake   # deterministic, no API key (CI)
    python -m evals.run --mode live   # real Gemini (needs GEMINI_API_KEY); measures answer quality

Runs every case in evals/cases.yaml through the real application (ASGI, Postgres + pgvector) and
exits non-zero when a pass-rate threshold in evals/thresholds.yaml is missed.

SAFETY: it truncates tables, so it only runs against a database whose name contains "eval" or
"test". Use e.g. ``EVAL_DATABASE_URL=postgresql+asyncpg://.../assistant_eval``.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import uuid
from pathlib import Path
from typing import Any

import yaml
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import text
from sqlalchemy.engine import make_url

from app.config import Settings
from app.db.models import User
from app.db.session import dispose_engine, get_sessionmaker, init_engine
from app.main import create_app
from app.security.auth import issue_session_token
from app.services import build_services

HERE = Path(__file__).parent
REFUSAL_MARKERS = ("override", "can't help", "not allowed", "can't process")


def _parse_sse(body: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for block in body.strip().split("\n\n"):
        for line in block.splitlines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
    return events


async def _make_user(settings: Settings, email: str, roles: list[str]) -> dict[str, str]:
    async with get_sessionmaker()() as s:
        user = User(email=email, name=email, google_sub=uuid.uuid4().hex, roles=roles)
        s.add(user)
        await s.commit()
        token, _ = issue_session_token(user, settings)
    return {"Authorization": f"Bearer {token}"}


async def run(mode: str) -> int:
    db_url = os.environ.get("EVAL_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
    name = make_url(db_url).database or ""
    if "eval" not in name and "test" not in name:
        print(f"Refusing to run: database '{name}' must contain 'eval' or 'test'.", file=sys.stderr)
        return 2

    settings = Settings(
        environment="local",
        log_level="CRITICAL",
        database_url=db_url,
        google_client_id="eval",
        allowed_email_domains=["eval.test"],
        session_secret=SecretStr("e" * 40),
        policy_file=str(HERE.parent / "config" / "policy.yaml"),
        cache_enabled=False,
        burst_requests_per_minute=10_000,
        daily_request_quota=10_000,
    )
    llm = None
    if mode == "fake":
        from tests.fakes import FakeLLM

        llm = FakeLLM()
    init_engine(settings)
    services = build_services(settings, llm=llm)
    await services.chunk_index.ensure()
    async with get_sessionmaker()() as s:
        await s.execute(
            text(
                "TRUNCATE users, documents, chunks, conversations, messages, pending_actions,"
                " integration_tokens, usage_counters, semantic_cache, invitations RESTART IDENTITY CASCADE"
            )
        )
        await s.commit()

    spec = yaml.safe_load((HERE / "cases.yaml").read_text())
    thresholds = yaml.safe_load((HERE / "thresholds.yaml").read_text())
    app = create_app(settings, services=services)
    app.state.services = services
    results: list[dict[str, Any]] = []
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://eval", timeout=120) as client:
        uploader = await _make_user(settings, "uploader@eval.test", ["employee", "hr"])
        for doc in spec["documents"]:
            resp = await client.post(
                "/v1/documents",
                headers=uploader,
                files={"file": (f"{doc['name']}.txt", doc["text"].encode(), "text/plain")},
                data={
                    "visibility": doc["visibility"],
                    "allowed_roles": ",".join(doc.get("allowed_roles", [])),
                },
            )
            assert resp.status_code == 202, resp.text

        for i, case in enumerate(spec["cases"]):
            headers = await _make_user(settings, f"user{i}@eval.test", case["role"])
            conv = (await client.post("/v1/conversations", headers=headers)).json()["id"]
            resp = await client.post(
                f"/v1/conversations/{conv}/messages", headers=headers, json={"text": case["question"]}
            )
            events = _parse_sse(resp.text)
            final = next((e for e in events if e["type"] == "final"), {"text": "", "citations": []})
            answer: str = final["text"]
            citations = final["citations"]
            failures: list[str] = []
            norm = answer.lower().replace(",", "").replace("$", "")  # "$150,000" == "150000"
            for bad in case.get("must_not_contain", []):
                if bad.lower() in norm:
                    failures.append(f"answer contains forbidden text {bad!r}")
            if case.get("must_contain_any") and not any(
                g.lower() in answer.lower() for g in case["must_contain_any"]
            ):
                failures.append(f"answer lacks any of {case['must_contain_any']}")
            if len(citations) < case.get("min_citations", 0):
                failures.append(f"expected >= {case['min_citations']} citations, got {len(citations)}")
            for title, limit in case.get("max_citations_from", {}).items():
                n = sum(1 for c in citations if c["title"] == title)
                if n > limit:
                    failures.append(f"{n} citations from '{title}' (max {limit})")
            if case.get("expect_refusal") and not any(m in answer.lower() for m in REFUSAL_MARKERS):
                failures.append("expected a refusal")
            results.append(
                {
                    "id": case["id"],
                    "category": case["category"],
                    "passed": not failures,
                    "failures": failures,
                    "answer": answer,
                }
            )

    await dispose_engine()

    exit_code = 0
    for category in ("security", "quality"):
        rows = [r for r in results if r["category"] == category]
        rate = sum(r["passed"] for r in rows) / len(rows) if rows else 1.0
        need = float(thresholds[f"{category}_pass_rate"])
        ok = rate >= need
        exit_code |= 0 if ok else 1
        print(f"[{'PASS' if ok else 'FAIL'}] {category}: {rate:.0%} (required {need:.0%}, {len(rows)} cases)")
    for r in results:
        if not r["passed"]:
            print(f"  - {r['id']}: {'; '.join(r['failures'])}")
            print(f"      answer: {r['answer'][:300]!r}")
    return exit_code


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["fake", "live"], default="fake")
    args = parser.parse_args()
    sys.exit(asyncio.run(run(args.mode)))


if __name__ == "__main__":
    main()
