import { describe, expect, it } from "vitest";
import { buildNavItems } from "./nav";

const activeIds = (p: string, v: string | null = null, admin = true) =>
  buildNavItems(p, v, admin).filter((i) => i.active).map((i) => i.id);

describe("buildNavItems", () => {
  it("marks exactly one item active per route", () => {
    expect(activeIds("/")).toEqual(["chat"]);
    expect(activeIds("/documents")).toEqual(["documents"]);
    expect(activeIds("/settings")).toEqual(["settings"]);
    expect(activeIds("/settings", "tools")).toEqual(["tools"]);
    expect(activeIds("/admin")).toEqual(["admin"]);
  });
  it("hides Admin for non-admins and links every item", () => {
    const items = buildNavItems("/admin", null, false);
    expect(items.map((i) => i.id)).not.toContain("admin");
    expect(items.every((i) => i.href.startsWith("/"))).toBe(true);
  });
});
