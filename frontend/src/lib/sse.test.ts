import { describe, expect, it } from "vitest";
import { parseSse } from "./sse";

describe("parseSse", () => {
  it("parses a complete event", () => {
    const r = parseSse("", 'event: token\ndata: {"type":"token","text":"hi"}\n\n');
    expect(r.messages).toEqual([{ event: "token", data: '{"type":"token","text":"hi"}' }]);
    expect(r.rest).toBe("");
  });

  it("handles events split across chunks at any boundary", () => {
    const full = 'event: a\ndata: {"x":1}\n\nevent: b\ndata: {"y":2}\n\n';
    for (let i = 1; i < full.length; i++) {
      const first = parseSse("", full.slice(0, i));
      const second = parseSse(first.rest, full.slice(i));
      expect([...first.messages, ...second.messages]).toEqual([
        { event: "a", data: '{"x":1}' },
        { event: "b", data: '{"y":2}' },
      ]);
    }
  });

  it("supports CRLF, comments, multi-line data and default event", () => {
    const r = parseSse("", ": ping\r\n\r\ndata: one\r\ndata: two\r\n\r\n");
    expect(r.messages).toEqual([{ event: "message", data: "one\ntwo" }]);
  });

  it("keeps an incomplete event in rest", () => {
    const r = parseSse("", "event: a\ndata: {");
    expect(r.messages).toEqual([]);
    expect(r.rest).toBe("event: a\ndata: {");
  });

  it("handles a CRLF pair split across chunks", () => {
    const a = parseSse("", "data: x\r\n\r");
    const b = parseSse(a.rest, "\n");
    expect([...a.messages, ...b.messages]).toEqual([{ event: "message", data: "x" }]);
  });
});
