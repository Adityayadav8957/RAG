import { describe, expect, it } from "vitest";
import { buildBackendHeaders, buildBackendUrl, filterResponseHeaders, isAllowedMethod } from "./proxy";

describe("buildBackendHeaders", () => {
  it("forwards content-type/accept, adds bearer, drops cookies", () => {
    const h = buildBackendHeaders(
      new Headers({
        cookie: "session=secret",
        "content-type": "multipart/form-data; boundary=x",
        accept: "text/event-stream",
        authorization: "Bearer attacker",
        "x-forwarded-for": "1.2.3.4",
      }),
      "tok",
    );
    expect(h.get("authorization")).toBe("Bearer tok");
    expect(h.get("content-type")).toBe("multipart/form-data; boundary=x");
    expect(h.get("accept")).toBe("text/event-stream");
    expect(h.get("cookie")).toBeNull();
    expect(h.get("x-forwarded-for")).toBeNull();
  });
});

describe("buildBackendUrl", () => {
  it("joins segments and query", () => {
    expect(buildBackendUrl("http://b:8000/", ["conversations", "1", "messages"], "?a=1")).toBe(
      "http://b:8000/v1/conversations/1/messages?a=1",
    );
  });
  it("rejects traversal", () => {
    expect(buildBackendUrl("http://b", ["..", "x"], "")).toBeNull();
    expect(buildBackendUrl("http://b", [], "")).toBeNull();
    expect(buildBackendUrl("http://b", ["a/b"], "")).toBeNull();
  });
});

describe("misc", () => {
  it("allows only GET/POST/PUT/DELETE", () => {
    expect(isAllowedMethod("get")).toBe(true);
    expect(isAllowedMethod("PATCH")).toBe(false);
  });
  it("strips hop-by-hop response headers", () => {
    const h = filterResponseHeaders(new Headers({ "set-cookie": "a=b", "content-type": "text/plain", "content-length": "3" }));
    expect(h.get("set-cookie")).toBeNull();
    expect(h.get("content-length")).toBeNull();
    expect(h.get("content-type")).toBe("text/plain");
  });
});
