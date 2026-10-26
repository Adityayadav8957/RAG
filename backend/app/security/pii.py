"""PII / secret detection used on both input and output (DLP).

Regex based on purpose: deterministic, fast, and testable. Each detector returns spans so
callers can mask, block or just report.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_SSN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
_CARD = re.compile(r"\b(?:\d[ -]?){13,19}\b")
_AWS_KEY = re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")
_GENERIC_SECRET = re.compile(
    r"(?i)\b(?:api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*['\"]?([A-Za-z0-9_\-./+=]{12,})"
)
_PRIVATE_KEY = re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----")
_GOOGLE_KEY = re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b")
_BEARER = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9\-._~+/]{20,}=*")


@dataclass(frozen=True)
class Finding:
    kind: str
    start: int
    end: int


def _luhn_ok(digits: str) -> bool:
    total, alt = 0, False
    for ch in reversed(digits):
        n = int(ch)
        if alt:
            n *= 2
            if n > 9:
                n -= 9
        total += n
        alt = not alt
    return total % 10 == 0


def find_pii(text: str, *, include_email: bool = False) -> list[Finding]:
    """Detect sensitive spans.

    Emails and phone numbers are ubiquitous in legitimate workplace questions, so emails are
    only reported when ``include_email`` is set (DLP of outputs may enable it).
    """
    findings: list[Finding] = []
    for m in _SSN.finditer(text):
        findings.append(Finding("ssn", m.start(), m.end()))
    for m in _CARD.finditer(text):
        digits = re.sub(r"\D", "", m.group())
        if 13 <= len(digits) <= 19 and _luhn_ok(digits):
            findings.append(Finding("credit_card", m.start(), m.end()))
    for pattern, kind in (
        (_AWS_KEY, "aws_access_key"),
        (_GOOGLE_KEY, "google_api_key"),
        (_PRIVATE_KEY, "private_key"),
        (_BEARER, "bearer_token"),
    ):
        for m in pattern.finditer(text):
            findings.append(Finding(kind, m.start(), m.end()))
    for m in _GENERIC_SECRET.finditer(text):
        findings.append(Finding("secret", m.start(1), m.end(1)))
    if include_email:
        for m in _EMAIL.finditer(text):
            findings.append(Finding("email", m.start(), m.end()))
    return _merge(findings)


def _merge(findings: list[Finding]) -> list[Finding]:
    findings.sort(key=lambda f: (f.start, -f.end))
    merged: list[Finding] = []
    for f in findings:
        if merged and f.start < merged[-1].end:
            continue
        merged.append(f)
    return merged


def mask_pii(text: str, findings: list[Finding] | None = None) -> str:
    findings = find_pii(text) if findings is None else findings
    out: list[str] = []
    cursor = 0
    for f in findings:
        out.append(text[cursor : f.start])
        out.append(f"[REDACTED:{f.kind}]")
        cursor = f.end
    out.append(text[cursor:])
    return "".join(out)
