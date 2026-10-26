import { describe, expect, it } from "vitest";
import { groupConversations } from "./conversations";

const now = new Date(2026, 9, 27, 12, 0, 0);
const c = (id: string, title: string, d: Date) => ({ id, title, updated_at: d.toISOString() });

describe("groupConversations", () => {
  const list = [
    c("1", "Leave policy", new Date(2026, 9, 27, 9)),
    c("2", "Jira tickets", new Date(2026, 9, 26, 20)),
    c("3", "Access", new Date(2026, 9, 22)),
    c("4", "Old one", new Date(2026, 8, 1)),
  ];
  it("groups by recency in order", () => {
    expect(groupConversations(list, "", now).map((g) => g.label)).toEqual(["Today", "Yesterday", "Previous 7 days", "Older"]);
  });
  it("filters by title and drops empty groups", () => {
    const g = groupConversations(list, "jira", now);
    expect(g).toHaveLength(1);
    expect(g[0]?.items[0]?.id).toBe("2");
  });
});
