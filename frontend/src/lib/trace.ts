import type { TraceEvent, TraceStatus } from "./types";

/* ---------- parsing (the backend payload is treated as untrusted shape) ---------- */

const STATUSES: readonly TraceStatus[] = ["running", "done", "blocked", "skipped", "waiting", "error"];
const isStatus = (v: unknown): v is TraceStatus => typeof v === "string" && (STATUSES as readonly string[]).includes(v);

export function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Returns null when the value cannot be a trace event. Unknown stages are kept; unknown statuses read as "done". */
export function parseTraceEvent(v: unknown): TraceEvent | null {
  const r = asRecord(v);
  if (!r || typeof r.stage !== "string" || typeof r.seq !== "number" || !Number.isFinite(r.seq)) return null;
  return {
    seq: r.seq,
    stage: r.stage,
    title: typeof r.title === "string" && r.title ? r.title : r.stage,
    status: isStatus(r.status) ? r.status : "done",
    at_ms: typeof r.at_ms === "number" && Number.isFinite(r.at_ms) ? r.at_ms : 0,
    ms: typeof r.ms === "number" && Number.isFinite(r.ms) ? r.ms : null,
    detail: asRecord(r.detail) ?? {},
  };
}

export function parseTrace(v: unknown): TraceEvent[] {
  if (!Array.isArray(v)) return [];
  const out: TraceEvent[] = [];
  for (const item of v) {
    const e = parseTraceEvent(item);
    if (e) out.push(e);
  }
  return sortTrace(dedupe(out));
}

function dedupe(list: TraceEvent[]): TraceEvent[] {
  const bySeq = new Map<number, TraceEvent>();
  for (const e of list) bySeq.set(e.seq, e); // a later event with the same seq updates that step in place
  return [...bySeq.values()];
}
const sortTrace = (list: TraceEvent[]) => [...list].sort((a, b) => a.seq - b.seq);

export interface Offsets {
  seqOffset: number;
  msOffset: number;
}

/** Offsets that place a resumed stream (approval) after an existing trace. */
export function offsetsAfter(trace: TraceEvent[]): Offsets {
  return {
    seqOffset: trace.reduce((m, e) => Math.max(m, e.seq), 0),
    msOffset: trace.reduce((m, e) => Math.max(m, e.at_ms + (e.ms ?? 0)), 0),
  };
}

/** Adds (or updates, by seq) one live event. */
export function mergeTrace(list: TraceEvent[], ev: TraceEvent, o: Offsets = { seqOffset: 0, msOffset: 0 }): TraceEvent[] {
  const shifted = o.seqOffset || o.msOffset ? { ...ev, seq: ev.seq + o.seqOffset, at_ms: ev.at_ms + o.msOffset } : ev;
  return sortTrace([...list.filter((e) => e.seq !== shifted.seq), shifted]);
}

/* ---------- detail accessors ---------- */

export const getStr = (d: Record<string, unknown>, k: string): string | null => (typeof d[k] === "string" && d[k] !== "" ? (d[k] as string) : null);
export const getNum = (d: Record<string, unknown>, k: string): number | null => (typeof d[k] === "number" && Number.isFinite(d[k]) ? (d[k] as number) : null);
export const getBool = (d: Record<string, unknown>, k: string): boolean | null => (typeof d[k] === "boolean" ? (d[k] as boolean) : null);
export function getStrArr(d: Record<string, unknown>, k: string): string[] {
  const v = d[k];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
export interface Hit {
  n: number | null;
  title: string;
}
export function getHits(d: Record<string, unknown>): Hit[] {
  const v = d.hits;
  if (!Array.isArray(v)) return [];
  const out: Hit[] = [];
  for (const h of v) {
    const r = asRecord(h);
    if (r && typeof r.title === "string") out.push({ n: typeof r.n === "number" ? r.n : null, title: r.title });
  }
  return out;
}

/* ---------- ordering and visibility ---------- */

/**
 * Events worth rendering: a "running" step is replaced by a later finished step of the same stage and title,
 * and an approval "waiting" step is replaced by the later approval decision.
 */
export function visibleEvents(trace: TraceEvent[]): TraceEvent[] {
  const sorted = sortTrace(trace);
  return sorted.filter((e, i) => {
    const later = sorted.slice(i + 1);
    if (e.status === "running") return !later.some((l) => l.stage === e.stage && l.title === e.title && l.status !== "running");
    if (e.status === "waiting" && e.stage === "approval") return !later.some((l) => l.stage === "approval" && l.status !== "waiting");
    return true;
  });
}

export const isComplete = (trace: TraceEvent[]) => trace.some((e) => e.stage === "done");

/* ---------- pipeline ---------- */

export type NodeKey = "input" | "intent" | "cache" | "router" | "work" | "validation" | "output";
export type NodeState = "pending" | "running" | "done" | "skipped" | "blocked" | "waiting" | "error";

export const PIPELINE: { key: NodeKey; label: string }[] = [
  { key: "input", label: "Input guardrails" },
  { key: "intent", label: "Intent" },
  { key: "cache", label: "Cache" },
  { key: "router", label: "Router" },
  { key: "work", label: "Retrieve / Tools" },
  { key: "validation", label: "Validate" },
  { key: "output", label: "Output guardrails" },
];

const WORK_STAGES = new Set(["retrieval", "tool", "llm", "approval"]);

/** Which pipeline node a stage belongs to; null for "done" and unknown stages. */
export function stageNode(stage: string): NodeKey | null {
  if (stage === "input" || stage === "intent" || stage === "cache" || stage === "router" || stage === "validation" || stage === "output") return stage;
  return WORK_STAGES.has(stage) ? "work" : null;
}

export interface NodeView {
  key: NodeKey;
  label: string;
  state: NodeState;
  ms: number | null;
}

export function cacheResult(trace: TraceEvent[]): string | null {
  const c = trace.find((e) => e.stage === "cache");
  return c ? getStr(c.detail, "result") : null;
}

export function pipelineNodes(trace: TraceEvent[]): NodeView[] {
  const events = visibleEvents(trace);
  const complete = isComplete(trace);
  const hit = cacheResult(trace) === "hit";
  return PIPELINE.map(({ key, label }) => {
    const evs = events.filter((e) => stageNode(e.stage) === key);
    let state: NodeState;
    if (evs.length === 0) state = complete && hit ? "skipped" : "pending";
    else if (evs.some((e) => e.status === "blocked")) state = "blocked";
    else if (evs.some((e) => e.status === "waiting")) state = "waiting";
    else if (evs.some((e) => e.status === "running")) state = "running";
    else if (evs[evs.length - 1]?.status === "error") state = "error";
    else if (evs.some((e) => e.status === "done")) state = "done";
    else state = "skipped";
    const timed = evs.filter((e) => e.ms !== null);
    return { key, label, state, ms: timed.length ? timed.reduce((s, e) => s + (e.ms ?? 0), 0) : null };
  });
}

/* ---------- latency + summary ---------- */

export interface Segment {
  key: string;
  label: string;
  ms: number;
  pct: number;
}

export interface Summary {
  finished: boolean;
  totalMs: number | null;
  modelCalls: number;
  fallbackUsed: boolean;
  cache: string | null;
  sources: number | null;
  blocked: number;
  errors: number;
}

export function summarize(trace: TraceEvent[]): Summary {
  const events = visibleEvents(trace);
  const total = trace.reduce((m, e) => Math.max(m, e.at_ms + (e.ms ?? 0)), 0);
  const llm = events.filter((e) => e.stage === "llm" && (e.status === "done" || e.status === "error"));
  const hitKeys = new Set<string>();
  for (const e of events) if (e.stage === "retrieval") for (const h of getHits(e.detail)) hitKeys.add(h.n !== null ? `n${h.n}` : h.title);
  const validation = events.find((e) => e.stage === "validation");
  const retrieved = validation ? getNum(validation.detail, "sources_retrieved") : null;
  const retrievalSeen = events.some((e) => e.stage === "retrieval" && e.status !== "running");
  return {
    finished: isComplete(trace),
    totalMs: trace.length && total > 0 ? total : null,
    modelCalls: llm.length,
    fallbackUsed: llm.some((e) => (getStr(e.detail, "provider") ?? "").startsWith("fallback")),
    cache: cacheResult(trace),
    sources: retrievalSeen ? hitKeys.size : retrieved,
    blocked: events.filter((e) => e.status === "blocked").length,
    errors: events.filter((e) => e.status === "error").length,
  };
}

/** Per pipeline stage durations as shares of the total. Only measured numbers; the remainder is labelled "Other". */
export function latencySegments(trace: TraceEvent[]): { segments: Segment[]; totalMs: number } {
  const nodes = pipelineNodes(trace);
  const measured = nodes.filter((n) => n.ms !== null && n.ms > 0);
  const sum = measured.reduce((s, n) => s + (n.ms ?? 0), 0);
  const total = Math.max(summarize(trace).totalMs ?? 0, sum);
  if (total <= 0) return { segments: [], totalMs: 0 };
  const segments: Segment[] = measured.map((n) => ({ key: n.key, label: n.label, ms: n.ms ?? 0, pct: ((n.ms ?? 0) / total) * 100 }));
  const other = total - sum;
  if (other > 0.5) segments.push({ key: "other", label: "Other", ms: other, pct: (other / total) * 100 });
  return { segments, totalMs: total };
}

export function formatMs(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
}
