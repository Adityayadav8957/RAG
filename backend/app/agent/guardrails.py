"""Input and output guardrails and untrusted-content handling."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from pydantic import BaseModel

from app.agent.policy import PolicyEngine
from app.agent.prompts import INJECTION_SYSTEM
from app.config import Settings
from app.llm.client import LLMClient, LLMError
from app.logging import get_logger
from app.observability.metrics import GUARDRAIL_EVENTS, LLM_CALLS
from app.security.injection import fence_untrusted, scan_text
from app.security.pii import find_pii, mask_pii

log = get_logger("guardrails")

_MD_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_HTML_IMG = re.compile(r"<img\b[^>]*>", re.I)

REFUSAL_INJECTION = (
    "I can't process that message because it looks like an attempt to override my safety "
    "rules. Please rephrase your request."
)


class _InjectionJudgement(BaseModel):
    is_injection: bool = False
    confidence: float = 0.0
    reason: str = ""


@dataclass
class InputVerdict:
    allowed: bool
    text: str
    reason: str = ""
    flags: list[str] = field(default_factory=list)


async def check_input(text: str, *, settings: Settings, policy: PolicyEngine, llm: LLMClient) -> InputVerdict:
    if len(text) > settings.max_input_chars:
        return InputVerdict(False, text, "Message is too long", ["too_long"])

    verdict = scan_text(text)
    flags = list(verdict.reasons)
    blocked = verdict.is_blocked(settings.injection_block_threshold)
    if not blocked and settings.injection_llm_check and verdict.score >= 0.4:
        try:
            LLM_CALLS.labels(model=settings.model_small, purpose="injection").inc()
            judgement = await llm.generate_json(
                model=settings.model_small,
                system=INJECTION_SYSTEM,
                prompt=f"<<<TEXT>>>\n{text}\n<<<END TEXT>>>",
                schema=_InjectionJudgement,
            )
            blocked = judgement.is_injection and judgement.confidence >= 0.6
        except LLMError:
            # Borderline and classifier down: fail closed.
            blocked = True
    if blocked:
        GUARDRAIL_EVENTS.labels(stage="input", action="injection_blocked").inc()
        return InputVerdict(False, text, REFUSAL_INJECTION, ["prompt_injection", *flags])

    decision = policy.check_request(text)
    if not decision.allowed:
        GUARDRAIL_EVENTS.labels(stage="input", action="policy_blocked").inc()
        return InputVerdict(False, text, decision.reason, [f"policy:{decision.rule_id}"])

    if settings.pii_input_mode != "off":
        findings = find_pii(text)
        if findings:
            kinds = sorted({f.kind for f in findings})
            if settings.pii_input_mode == "block":
                GUARDRAIL_EVENTS.labels(stage="input", action="pii_blocked").inc()
                return InputVerdict(
                    False, text, "Please remove sensitive data (" + ", ".join(kinds) + ") and retry.", ["pii"]
                )
            GUARDRAIL_EVENTS.labels(stage="input", action="pii_masked").inc()
            return InputVerdict(True, mask_pii(text, findings), flags=[*flags, *(f"pii:{k}" for k in kinds)])
    return InputVerdict(True, text, flags=flags)


def sanitize_untrusted(label: str, content: str, settings: Settings) -> tuple[str | None, float]:
    """Scan then fence untrusted content. Returns ``(None, score)`` if it must be dropped."""
    verdict = scan_text(content)
    if verdict.is_blocked(settings.injection_block_threshold):
        GUARDRAIL_EVENTS.labels(stage="untrusted", action="dropped").inc()
        log.warning("untrusted_content_dropped", label=label, reasons=verdict.reasons)
        return None, verdict.score
    return fence_untrusted(label, content), verdict.score


@dataclass
class OutputVerdict:
    text: str
    blocked: bool = False
    modified: bool = False
    reasons: list[str] = field(default_factory=list)


def check_output(text: str, *, settings: Settings, policy: PolicyEngine) -> OutputVerdict:
    reasons: list[str] = []
    modified = False

    decision = policy.check_output(text)
    if not decision.allowed:
        GUARDRAIL_EVENTS.labels(stage="output", action="policy_blocked").inc()
        return OutputVerdict(
            "I can't share that response.", blocked=True, modified=True, reasons=[decision.rule_id]
        )

    # Images are a classic zero-click exfiltration channel (URL carries data); drop them.
    stripped = _HTML_IMG.sub("", _MD_IMAGE.sub("", text))
    if stripped != text:
        text, modified = stripped, True
        reasons.append("image_removed")
        GUARDRAIL_EVENTS.labels(stage="output", action="image_removed").inc()

    if settings.pii_output_mode != "off":
        findings = find_pii(text)
        if findings:
            kinds = sorted({f.kind for f in findings})
            if settings.pii_output_mode == "block":
                GUARDRAIL_EVENTS.labels(stage="output", action="dlp_blocked").inc()
                return OutputVerdict(
                    "I can't share that response because it contains sensitive data.",
                    blocked=True,
                    modified=True,
                    reasons=[f"dlp:{k}" for k in kinds],
                )
            text, modified = mask_pii(text, findings), True
            reasons.extend(f"dlp:{k}" for k in kinds)
            GUARDRAIL_EVENTS.labels(stage="output", action="dlp_masked").inc()
    return OutputVerdict(text, modified=modified, reasons=reasons)
