"""Intent classification (small model) and model routing."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from app.agent.prompts import INTENT_SYSTEM
from app.config import Settings
from app.llm.client import LLMClient, LLMError
from app.logging import get_logger
from app.observability.metrics import LLM_CALLS

log = get_logger("intent")

Intent = Literal["knowledge", "action", "simple", "smalltalk", "unsafe"]


class IntentResult(BaseModel):
    intent: Intent = "knowledge"
    complexity: Literal["low", "high"] = "high"
    needs_knowledge: bool = True
    summary: str = ""


# Used when the classifier is unavailable: assume the most capable, most guarded path.
FALLBACK_INTENT = IntentResult(intent="knowledge", complexity="high", needs_knowledge=True)


async def classify_intent(llm: LLMClient, settings: Settings, text: str) -> IntentResult:
    try:
        LLM_CALLS.labels(model=settings.model_small, purpose="intent").inc()
        return await llm.generate_json(
            model=settings.model_small,
            system=INTENT_SYSTEM,
            prompt=f"<<<MESSAGE>>>\n{text}\n<<<END MESSAGE>>>",
            schema=IntentResult,
        )
    except LLMError:
        log.warning("intent_fallback")
        return FALLBACK_INTENT


def choose_model(settings: Settings, intent: IntentResult) -> str:
    """Cheap model for simple traffic, frontier model for actions and hard questions."""
    if intent.intent in ("smalltalk", "simple") and intent.complexity == "low":
        return settings.model_small
    if intent.intent == "knowledge" and intent.complexity == "low":
        return settings.model_small
    return settings.model_frontier
