"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Conversation } from "@/lib/types";

interface Ctx {
  conversations: Conversation[];
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  add: (c: Conversation) => void;
  /** Asks for confirmation, deletes on the server and updates the list. Resolves true when deleted. */
  remove: (c: Conversation) => Promise<boolean>;
}

const noop = async () => undefined;
const ConversationsContext = createContext<Ctx>({
  conversations: [], loaded: false, error: null, refresh: noop, add: () => undefined, remove: async () => false,
});

export function ConversationsProvider({ children }: { children: React.ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setConversations(await api.listConversations());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Network error.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback((c: Conversation) => setConversations((cs) => [c, ...cs.filter((x) => x.id !== c.id)]), []);

  const remove = useCallback(async (c: Conversation) => {
    if (!window.confirm(`Delete "${c.title || "Untitled"}"? This cannot be undone.`)) return false;
    // Optimistic: drop it from the list now and restore it if the server refuses.
    setConversations((cs) => cs.filter((x) => x.id !== c.id));
    try {
      await api.deleteConversation(c.id);
      return true;
    } catch (e) {
      setConversations((cs) => (cs.some((x) => x.id === c.id) ? cs : [c, ...cs].sort((a, b) => b.updated_at.localeCompare(a.updated_at))));
      setError(e instanceof ApiError ? e.detail : "Network error.");
      return false;
    }
  }, []);

  const value = useMemo(
    () => ({ conversations, loaded, error, refresh, add, remove }),
    [conversations, loaded, error, refresh, add, remove],
  );
  return <ConversationsContext.Provider value={value}>{children}</ConversationsContext.Provider>;
}

export function useConversations(): Ctx {
  return useContext(ConversationsContext);
}
