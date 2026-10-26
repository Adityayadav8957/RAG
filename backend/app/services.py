"""Dependency container, built once at startup and attached to ``app.state``."""

from __future__ import annotations

from dataclasses import dataclass

from app.agent.gateway import ToolGateway
from app.agent.mcp_client import McpClient
from app.agent.policy import PolicyEngine
from app.cache.semantic import SemanticCache
from app.config import Settings
from app.llm.client import GeminiClient, LLMClient
from app.llm.openai_compat import FallbackLLM, OpenAICompatClient
from app.rag.vectorstore import CacheIndex, ChunkIndex
from app.security.crypto import TokenCipher, get_cipher


@dataclass
class Services:
    settings: Settings
    llm: LLMClient
    chunk_index: ChunkIndex
    cache_index: CacheIndex
    cache: SemanticCache
    policy: PolicyEngine
    gateway: ToolGateway
    cipher: TokenCipher


def build_llm(settings: Settings) -> LLMClient:
    primary: LLMClient = GeminiClient(settings)
    if settings.fallback_api_key is not None and settings.fallback_model_small:
        secondary = OpenAICompatClient(
            base_url=settings.fallback_base_url,
            api_key=settings.fallback_api_key.get_secret_value(),
            timeout=settings.llm_timeout_seconds,
        )
        return FallbackLLM(primary, secondary, settings, prefer_secondary=settings.llm_prefer_fallback)
    return primary


def build_services(settings: Settings, llm: LLMClient | None = None) -> Services:
    chunk_index = ChunkIndex(settings)
    cache_index = CacheIndex(settings)
    policy = PolicyEngine.from_file(settings.policy_file)
    cipher = get_cipher(settings)
    return Services(
        settings=settings,
        llm=llm or build_llm(settings),
        chunk_index=chunk_index,
        cache_index=cache_index,
        cache=SemanticCache(cache_index, settings),
        policy=policy,
        gateway=ToolGateway(settings, policy, McpClient(settings), cipher),
        cipher=cipher,
    )
