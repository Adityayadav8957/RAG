import type { Conversation } from "./types";

export interface ConversationGroup {
  label: string;
  items: Conversation[];
}

const DAY = 86_400_000;

function bucket(updatedAt: string, now: Date): string {
  const t = new Date(updatedAt).getTime();
  if (Number.isNaN(t)) return "Older";
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t >= startOfToday) return "Today";
  if (t >= startOfToday - DAY) return "Yesterday";
  if (t >= startOfToday - 7 * DAY) return "Previous 7 days";
  return "Older";
}

const ORDER = ["Today", "Yesterday", "Previous 7 days", "Older"];

/** Filter by title (case-insensitive) and group by recency; empty groups are dropped. */
export function groupConversations(list: Conversation[], query: string, now: Date = new Date()): ConversationGroup[] {
  const q = query.trim().toLowerCase();
  const filtered = q ? list.filter((c) => (c.title || "Untitled").toLowerCase().includes(q)) : list;
  return ORDER.map((label) => ({ label, items: filtered.filter((c) => bucket(c.updated_at, now) === label) })).filter(
    (g) => g.items.length > 0,
  );
}
