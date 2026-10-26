import { describe, expect, it } from "vitest";
import {
  formatMs, latencySegments, mergeTrace, offsetsAfter, parseTrace, parseTraceEvent, pipelineNodes, stageNode, summarize, visibleEvents,
} from "./trace";
import type { TraceEvent, TraceStatus } from "./types";

let n = 0;
const ev = (stage: string, status: TraceStatus, o: Partial<TraceEvent> = {}): TraceEvent => ({
  seq: ++n, stage, title: o.title ?? stage, status, at_ms: o.at_ms ?? n * 10, ms: o.ms ?? null, detail: o.detail ?? {}, ...(o.seq ? { seq: o.seq } : {}),
});
const state = (t: TraceEvent[], key: string) => pipelineNodes(t).find((x) => x.key === key)?.state;

describe("parsing", () => {
  it("rejects malformed events and tolerates missing fields", () => {
    expect(parseTraceEvent(null)).toBeNull();
    expect(parseTraceEvent({ stage: "x" })).toBeNull();
    const e = parseTraceEvent({ seq: 1, stage: "mystery", status: "weird", detail: "nope" });
    expect(e).toMatchObject({ title: "mystery", status: "done", ms: null, detail: {} });
  });
  it("sorts and dedupes by seq", () => {
    const t = parseTrace([{ seq: 2, stage: "intent", status: "done" }, { seq: 1, stage: "input", status: "running" }, { seq: 1, stage: "input", status: "done" }]);
    expect(t.map((e) => [e.seq, e.status])).toEqual([[1, "done"], [2, "done"]]);
    expect(parseTrace("bad")).toEqual([]);
  });
});

describe("live partial trace", () => {
  it("lights reached nodes only", () => {
    const t = [ev("input", "done", { ms: 3 }), ev("intent", "running")];
    expect(state(t, "input")).toBe("done");
    expect(state(t, "intent")).toBe("running");
    expect(state(t, "router")).toBe("pending");
    expect(summarize(t).finished).toBe(false);
  });
  it("mergeTrace upserts by seq", () => {
    let t: TraceEvent[] = [];
    t = mergeTrace(t, { seq: 1, stage: "input", title: "Input", status: "running", at_ms: 1, ms: null, detail: {} });
    t = mergeTrace(t, { seq: 1, stage: "input", title: "Input", status: "done", at_ms: 1, ms: 4, detail: {} });
    expect(t).toHaveLength(1);
    expect(t[0]?.status).toBe("done");
  });
});

describe("cache hit path", () => {
  const t = [
    ev("input", "done", { ms: 2 }),
    ev("intent", "done", { ms: 10 }),
    ev("cache", "done", { ms: 5, detail: { result: "hit" } }),
    ev("done", "done", { at_ms: 30, detail: { total_ms: 30, cached: true } }),
  ];
  it("marks unreached stages skipped once complete", () => {
    expect(state(t, "router")).toBe("skipped");
    expect(state(t, "work")).toBe("skipped");
    expect(state(t, "cache")).toBe("done");
    const s = summarize(t);
    expect(s).toMatchObject({ cache: "hit", modelCalls: 0, finished: true });
  });
});

describe("blocked input", () => {
  it("shows blocked and leaves the rest dim", () => {
    const t = [ev("input", "blocked", { detail: { reason: "prompt injection" } }), ev("done", "done", { at_ms: 12 })];
    expect(state(t, "input")).toBe("blocked");
    expect(state(t, "intent")).toBe("pending");
    expect(summarize(t).blocked).toBe(1);
  });
});

describe("approval", () => {
  it("is waiting until the decision arrives, then done", () => {
    const waiting = [ev("tool", "done"), ev("approval", "waiting", { detail: { tool: "jira.update" } })];
    expect(state(waiting, "work")).toBe("waiting");
    const resumed = [...waiting, ev("approval", "done", { detail: { decision: "approved" } })];
    expect(state(resumed, "work")).toBe("done");
    expect(visibleEvents(resumed).filter((e) => e.stage === "approval")).toHaveLength(1);
  });
  it("rebases a resumed stream after the existing trace", () => {
    const base = [ev("approval", "waiting", { seq: 5, at_ms: 100, ms: 20 })];
    const o = offsetsAfter(base);
    expect(o).toEqual({ seqOffset: 5, msOffset: 120 });
    const merged = mergeTrace(base, { seq: 1, stage: "approval", title: "Approval", status: "done", at_ms: 3, ms: 1, detail: {} }, o);
    expect(merged.map((e) => e.seq)).toEqual([5, 6]);
    expect(merged[1]?.at_ms).toBe(123);
  });
});

describe("repeated llm and retrieval events", () => {
  const t = [
    ev("retrieval", "done", { ms: 40, detail: { hits: [{ n: 1, title: "A" }, { n: 2, title: "B" }] } }),
    ev("llm", "error", { ms: 100, detail: { provider: "gemini" } }),
    ev("llm", "done", { ms: 200, detail: { provider: "fallback (openai/gpt-oss-120b)" } }),
    ev("retrieval", "done", { ms: 30, detail: { hits: [{ n: 2, title: "B" }, { n: 3, title: "C" }] } }),
    ev("llm", "done", { ms: 150, detail: { provider: "gemini" } }),
  ];
  it("counts calls, dedupes sources, flags fallback, ends in done", () => {
    const s = summarize(t);
    expect(s.modelCalls).toBe(3);
    expect(s.sources).toBe(3);
    expect(s.fallbackUsed).toBe(true);
    expect(s.errors).toBe(1);
    expect(state(t, "work")).toBe("done");
  });
  it("splits latency by stage using measured numbers only", () => {
    const { segments, totalMs } = latencySegments(t);
    const work = segments.find((x) => x.key === "work");
    expect(work?.ms).toBe(520);
    expect(totalMs).toBeGreaterThanOrEqual(520);
    expect(segments.reduce((a, b) => a + b.pct, 0)).toBeCloseTo(100, 5);
  });
});

describe("running steps", () => {
  it("hides a running step replaced by its finished twin", () => {
    const t = [ev("llm", "running", { title: "Model call" }), ev("llm", "done", { title: "Model call", ms: 5 })];
    expect(visibleEvents(t)).toHaveLength(1);
  });
});

describe("unknown stages", () => {
  it("never crash and map to no pipeline node", () => {
    const t = [ev("quantum", "done", { detail: { x: 1 } }), ev("input", "done")];
    expect(stageNode("quantum")).toBeNull();
    expect(() => pipelineNodes(t)).not.toThrow();
    expect(() => summarize(t)).not.toThrow();
    expect(summarize([]).totalMs).toBeNull();
    expect(latencySegments([]).segments).toEqual([]);
  });
});

describe("formatMs", () => {
  it("formats", () => {
    expect(formatMs(null)).toBe("");
    expect(formatMs(420)).toBe("420 ms");
    expect(formatMs(1500)).toBe("1.50 s");
  });
});
