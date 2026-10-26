"""Prometheus metrics."""

from __future__ import annotations

from prometheus_client import Counter, Histogram

HTTP_REQUESTS = Counter("http_requests_total", "HTTP requests", ["method", "route", "status"])
HTTP_LATENCY = Histogram("http_request_seconds", "HTTP latency", ["route"])
CHAT_REQUESTS = Counter("chat_requests_total", "Chat requests", ["intent", "outcome"])
CACHE_LOOKUPS = Counter("semantic_cache_lookups_total", "Semantic cache lookups", ["result"])
LLM_CALLS = Counter("llm_calls_total", "LLM calls", ["model", "purpose"])
GUARDRAIL_EVENTS = Counter("guardrail_events_total", "Guardrail activations", ["stage", "action"])
TOOL_CALLS = Counter("tool_calls_total", "Tool calls", ["tool", "outcome"])
RETRIEVALS = Counter("retrievals_total", "Retrievals", ["outcome"])
STEP_LATENCY = Histogram("pipeline_step_seconds", "Pipeline step latency", ["step"])
