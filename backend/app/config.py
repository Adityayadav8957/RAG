"""Application settings, loaded from environment variables (12-factor).

Every setting has a safe default for local development except secrets, which must be
provided explicitly outside of ``ENVIRONMENT=local``.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    environment: Literal["local", "staging", "production"] = "local"
    log_level: str = "INFO"
    public_base_url: str = "http://localhost:8000"
    frontend_origin: str = "http://localhost:3000"

    # --- Database (Neon Postgres) -------------------------------------------------
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/assistant"
    db_pool_size: int = 5
    db_max_overflow: int = 5

    # --- Authentication / sessions ------------------------------------------------
    google_client_id: str = ""
    # NoDecode: accept plain comma-separated values (a@x.com,b@x.com) as well as JSON lists.
    allowed_email_domains: Annotated[list[str], NoDecode] = Field(default_factory=list)
    admin_emails: Annotated[list[str], NoDecode] = Field(default_factory=list)
    # open: anyone can sign up (company domains share a workspace, everyone else gets a personal one).
    # restricted: only ALLOWED_EMAIL_DOMAINS, ADMIN_EMAILS and invited emails may sign in.
    signup_mode: Literal["open", "restricted"] = "open"
    session_secret: SecretStr = SecretStr("dev-only-change-me-dev-only-change-me")
    session_ttl_minutes: int = 480

    # --- Secrets at rest ----------------------------------------------------------
    # Fernet key (urlsafe base64, 32 bytes) used to encrypt third-party OAuth tokens.
    token_encryption_key: SecretStr | None = None

    # --- LLM (Gemini) -------------------------------------------------------------
    gemini_api_key: SecretStr | None = None
    model_small: str = "gemini-3.5-flash-lite"
    model_frontier: str = "gemini-3.5-flash"
    # Optional second provider (OpenAI-compatible: xAI Grok, Groq, OpenRouter, Ollama...).
    # Used only when Gemini fails (quota, outage). Chat only; embeddings stay on Gemini.
    fallback_api_key: SecretStr | None = None
    fallback_base_url: str = "https://api.x.ai/v1"
    fallback_model_small: str = ""
    fallback_model_frontier: str = ""
    # Answer with the OpenAI-compatible provider first (faster, steadier); Gemini then becomes the fallback.
    llm_prefer_fallback: bool = False
    embedding_model: str = "gemini-embedding-001"
    embedding_dim: int = 768
    llm_timeout_seconds: float = 60.0
    llm_max_retries: int = 4

    # --- RAG ----------------------------------------------------------------------
    chunk_size_chars: int = 1200
    chunk_overlap_chars: int = 150
    retrieval_top_k: int = 8
    retrieval_candidates: int = 24
    llm_rerank: bool = True
    max_upload_mb: int = 10

    # --- Semantic cache -----------------------------------------------------------
    cache_enabled: bool = True
    cache_similarity_threshold: float = 0.93
    cache_ttl_seconds: int = 3600

    # --- Guardrails ---------------------------------------------------------------
    injection_block_threshold: float = 0.8
    injection_llm_check: bool = True
    pii_input_mode: Literal["mask", "block", "off"] = "mask"
    pii_output_mode: Literal["mask", "block", "off"] = "mask"
    strict_grounding: bool = True
    policy_file: str = "config/policy.yaml"

    # --- Quotas -------------------------------------------------------------------
    daily_request_quota: int = 300
    burst_requests_per_minute: int = 20
    max_input_chars: int = 8000
    max_agent_steps: int = 6

    # --- Tools / MCP --------------------------------------------------------------
    jira_mcp_url: str = "http://localhost:8100/mcp"
    mcp_shared_secret: SecretStr = SecretStr("dev-only-mcp-secret")
    approval_ttl_minutes: int = 15
    metrics_token: SecretStr | None = None
    jira_oauth_client_id: str = ""
    jira_oauth_client_secret: SecretStr | None = None

    @field_validator("allowed_email_domains", "admin_emails", mode="before")
    @classmethod
    def _split_csv(cls, v: object) -> object:
        if isinstance(v, str):
            stripped = v.strip()
            if stripped.startswith("["):
                import json

                return [str(p).lower() for p in json.loads(stripped)]
            return [p.strip().lower() for p in stripped.split(",") if p.strip()]
        return v

    @model_validator(mode="after")
    def _require_secrets_outside_local(self) -> Settings:
        if self.environment == "local":
            return self
        problems: list[str] = []
        if "dev-only" in self.session_secret.get_secret_value():
            problems.append("SESSION_SECRET must be set")
        if "dev-only" in self.mcp_shared_secret.get_secret_value():
            problems.append("MCP_SHARED_SECRET must be set")
        if not self.google_client_id:
            problems.append("GOOGLE_CLIENT_ID must be set")
        if not self.allowed_email_domains:
            problems.append("ALLOWED_EMAIL_DOMAINS must be set")
        if self.token_encryption_key is None:
            problems.append("TOKEN_ENCRYPTION_KEY must be set")
        if self.gemini_api_key is None:
            problems.append("GEMINI_API_KEY must be set")
        if problems:
            raise ValueError("Invalid production configuration: " + "; ".join(problems))
        return self

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
