from __future__ import annotations

import os
import subprocess
import sys
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import Settings
from app.db.models import IntegrationToken, User
from app.db.session import dispose_engine, get_sessionmaker, init_engine
from app.main import create_app
from app.security.auth import issue_session_token
from app.security.crypto import get_cipher
from app.services import Services, build_services
from tests.fakes import FakeLLM, FakeMcp

BACKEND_DIR = Path(__file__).resolve().parent.parent
ADMIN_URL = os.environ.get(
    "TEST_ADMIN_DB_URL", "postgresql+asyncpg://postgres:postgres@localhost:5433/postgres"
)
TEST_DB = "assistant_test"
TEST_DB_URL = ADMIN_URL.rsplit("/", 1)[0] + f"/{TEST_DB}"


def _infra_available() -> bool:
    import socket
    from urllib.parse import urlsplit

    for url in (ADMIN_URL.replace("+asyncpg", ""),):
        parts = urlsplit(url)
        try:
            with socket.create_connection((parts.hostname or "localhost", parts.port or 80), timeout=1):
                pass
        except OSError:
            return False
    return True


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if _infra_available():
        return
    skip = pytest.mark.skip(reason="Postgres (pgvector) not reachable (run `docker compose up -d postgres`)")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(scope="session")
def test_settings() -> Settings:
    return Settings(
        _env_file=None,
        environment="local",
        log_level="CRITICAL",
        database_url=TEST_DB_URL,
        google_client_id="test-client",
        allowed_email_domains=["acme.test"],
        signup_mode="restricted",
        admin_emails=["admin@acme.test"],
        session_secret=SecretStr("x" * 40),
        policy_file=str(BACKEND_DIR / "config" / "policy.yaml"),
        llm_rerank=False,
        injection_llm_check=False,
        cache_similarity_threshold=0.9,
        jira_oauth_client_id="jira-client",
        jira_oauth_client_secret=SecretStr("jira-secret"),
        burst_requests_per_minute=1000,
    )


@pytest_asyncio.fixture(scope="session")
async def database(test_settings: Settings) -> AsyncIterator[None]:
    if not _infra_available():
        yield
        return
    admin = create_async_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
    async with admin.connect() as conn:
        await conn.execute(text(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)"))
        await conn.execute(text(f"CREATE DATABASE {TEST_DB}"))
    env = {**os.environ, "DATABASE_URL": TEST_DB_URL}
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND_DIR, env=env, check=True)
    yield
    async with admin.connect() as conn:
        await conn.execute(text(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)"))
    await admin.dispose()


@pytest.fixture
def fake_llm() -> FakeLLM:
    return FakeLLM()


@pytest.fixture
def fake_mcp() -> FakeMcp:
    return FakeMcp()


@pytest_asyncio.fixture
async def services(
    test_settings: Settings, database: None, fake_llm: FakeLLM, fake_mcp: FakeMcp
) -> AsyncIterator[Services]:
    init_engine(test_settings)
    svc = build_services(test_settings, llm=fake_llm)
    svc.gateway._mcp = fake_mcp  # type: ignore[assignment]
    await svc.chunk_index.ensure()
    async with get_sessionmaker()() as s:
        await s.execute(
            text(
                "TRUNCATE users, documents, chunks, conversations, messages, pending_actions,"
                " integration_tokens, usage_counters, semantic_cache, invitations RESTART IDENTITY CASCADE"
            )
        )
        await s.commit()
    yield svc
    await dispose_engine()


@pytest_asyncio.fixture
async def client(services: Services, test_settings: Settings) -> AsyncIterator[AsyncClient]:
    app = create_app(test_settings, services=services)
    app.state.services = services
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def make_user(
    email: str, roles: list[str], settings: Settings, *, jira: bool = False, tenant: str | None = None
) -> tuple[User, dict[str, str]]:
    async with get_sessionmaker()() as session:
        user = User(
            email=email,
            name=email.split("@")[0],
            google_sub=uuid.uuid4().hex,
            roles=roles,
            tenant=tenant if tenant is not None else email.rsplit("@", 1)[-1],
        )
        session.add(user)
        await session.flush()
        if jira:
            cipher = get_cipher(settings)
            session.add(
                IntegrationToken(
                    user_id=user.id,
                    provider="jira",
                    access_token_enc=cipher.encrypt("jira-access-token"),
                    refresh_token_enc=cipher.encrypt("jira-refresh"),
                    expires_at=datetime.now(UTC) + timedelta(hours=1),
                    meta={"cloud_id": "cloud-1", "site_url": "https://acme.atlassian.net"},
                )
            )
        await session.commit()
        token, _ = issue_session_token(user, settings)
    return user, {"Authorization": f"Bearer {token}"}


@pytest.fixture
def make_user_fn(test_settings: Settings):  # type: ignore[no-untyped-def]
    async def _make(
        email: str, roles: list[str], *, jira: bool = False, tenant: str | None = None
    ) -> tuple[User, dict[str, str]]:
        return await make_user(email, roles, test_settings, jira=jira, tenant=tenant)

    return _make


def parse_sse(body: str) -> list[dict[str, object]]:
    import json

    events = []
    for block in body.strip().split("\n\n"):
        for line in block.splitlines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
    return events
