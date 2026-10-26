import { describe, expect, it, vi } from "vitest";
import { createFetchCache } from "./fetchCache";

describe("fetchCache", () => {
  it("fetches, caches and notifies subscribers", async () => {
    const c = createFetchCache();
    const fn = vi.fn();
    c.subscribe("k", fn);
    await c.revalidate("k", async () => [1, 2]);
    expect(c.get("k").data).toEqual([1, 2]);
    expect(c.get("k").validating).toBe(false);
    expect(fn).toHaveBeenCalled();
  });

  it("dedupes concurrent requests", async () => {
    const c = createFetchCache();
    const f = vi.fn(async () => "x");
    await Promise.all([c.revalidate("k", f), c.revalidate("k", f)]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("serves fresh data without refetching, refetches when stale", async () => {
    let t = 1000;
    const c = createFetchCache(() => t);
    const f = vi.fn(async () => t);
    await c.revalidate("k", f, 5000);
    t = 3000;
    await c.revalidate("k", f, 5000);
    expect(f).toHaveBeenCalledTimes(1);
    t = 7000;
    await c.revalidate("k", f, 5000);
    expect(f).toHaveBeenCalledTimes(2);
    expect(c.get("k").data).toBe(7000);
  });

  it("keeps stale data visible while revalidating and when the refetch fails", async () => {
    const c = createFetchCache();
    await c.revalidate("k", async () => "old");
    let release: (v: string) => void = () => undefined;
    const p = c.revalidate("k", () => new Promise<string>((r) => (release = r)));
    expect(c.get("k")).toMatchObject({ data: "old", validating: true });
    release("new");
    await p;
    expect(c.get("k").data).toBe("new");
    await c.revalidate("k", async () => {
      throw new Error("boom");
    });
    expect(c.get("k")).toMatchObject({ data: "new", validating: false });
    expect((c.get("k").error as Error).message).toBe("boom");
  });

  it("records an error with no data, and recovers on retry", async () => {
    const c = createFetchCache();
    await c.revalidate("k", async () => {
      throw new Error("down");
    });
    expect(c.get("k").data).toBeUndefined();
    expect(c.get("k").error).toBeInstanceOf(Error);
    await c.revalidate("k", async () => "ok");
    expect(c.get("k")).toMatchObject({ data: "ok", error: undefined });
  });

  it("supports optimistic set with an updater, and clear", async () => {
    const c = createFetchCache();
    await c.revalidate<number[]>("k", async () => [1]);
    c.set<number[]>("k", (p) => [...(p ?? []), 2]);
    expect(c.get("k").data).toEqual([1, 2]);
    c.clear();
    expect(c.get("k").data).toBeUndefined();
  });

  it("returns a referentially stable snapshot between changes", async () => {
    const c = createFetchCache();
    await c.revalidate("k", async () => 1);
    expect(c.get("k")).toBe(c.get("k"));
  });
});
