"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, streamChat } from "@/lib/api";
import { mergeTrace, offsetsAfter, parseTrace, parseTraceEvent } from "@/lib/trace";
import type { ChatEvent, PendingAction, TraceEvent } from "@/lib/types";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { ApprovalCard } from "./ApprovalCard";
import { Composer, MAX_LEN } from "./chat/Composer";
import type { PanelMode, PanelTab } from "./chat/ContextPanel";
import { MessageView } from "./chat/MessageView";
import type { UiMessage } from "./chat/types";
import { Welcome } from "./chat/Welcome";
import { useConversations } from "./ConversationsProvider";
import { PanelRight, TriangleAlert } from "./icons";
import { DobbyBurst } from "./DobbyBurst";
import { Skel } from "./skeletons";

// Rarely-needed pieces load on demand; they are also warmed up after first paint (see the idle effect below).
const loadPanel = () => import("./chat/ContextPanel").then((m) => m.ContextPanel);
const ContextPanel = dynamic(loadPanel, { ssr: false });
const ApprovalModal = dynamic(() => import("./ApprovalModal").then((m) => m.ApprovalModal), { ssr: false });

let counter = 0;
const nextKey = () => `local-${++counter}`;

function errorText(e: unknown, approval: boolean): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return e.detail && e.detail !== "Too Many Requests" ? e.detail : "Too many requests. Please wait a moment and try again.";
    if (approval && (e.status === 404 || e.status === 409)) return "This action expired or was already handled.";
    if (e.status === 404) return "This conversation no longer exists.";
    return e.detail || "Something went wrong.";
  }
  return "Network error. Please try again.";
}

export function ChatView() {
  const router = useRouter();
  const params = useSearchParams();
  const convParam = params.get("c");
  const { conversations, add, refresh } = useConversations();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loadingConv, setLoadingConv] = useState(false);
  const [approvals, setApprovals] = useState<PendingAction[]>([]);
  const [reviewing, setReviewing] = useState<PendingAction | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMsg, setPanelMsg] = useState<string | null>(null);
  const [panelN, setPanelN] = useState<number | null>(null);
  const [tab, setTab] = useState<PanelTab>("sources");
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<string | null>(null);
  /** Where an approval was raised, so the resumed stream continues the same message and trace. */
  const approvalOrigins = useRef<Record<string, { key: string; trace: TraceEvent[] }>>({});
  const wide = useMediaQuery("(min-width: 1180px)");
  const phone = useMediaQuery("(max-width: 639px)");

  // Warm the lazy chunks once the page is idle so opening the panel or an answer never waits on the network.
  useEffect(() => {
    const warm = () => {
      void loadPanel();
      void import("./Markdown");
    };
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(warm);
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(warm, 1500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, approvals, error]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setApprovals([]);
    setReviewing(null);
    setError(null);
    setLive("");
    setPanelMsg(null);
    setPanelN(null);
  }, []);

  const selectConversation = useCallback(
    async (id: string) => {
      reset();
      activeRef.current = id;
      setLoadingConv(true);
      try {
        const [msgs, pending] = await Promise.all([api.messages(id), api.pending(id)]);
        if (activeRef.current !== id) return;
        setMessages(
          msgs.map((m) => ({ key: m.id, role: m.role, text: m.text, citations: m.citations ?? [], steps: [], trace: m.role === "assistant" ? parseTrace(m.trace) : [], streaming: false, stopped: false })),
        );
        setApprovals(pending);
      } catch (e) {
        if (activeRef.current === id) setError(errorText(e, false));
      } finally {
        if (activeRef.current === id) setLoadingConv(false);
      }
    },
    [reset],
  );

  // The URL (?c=<id>) is the source of truth for the open conversation.
  useEffect(() => {
    if (convParam === activeRef.current) return;
    if (convParam) {
      void selectConversation(convParam);
    } else {
      activeRef.current = null;
      setLoadingConv(false);
      reset();
    }
  }, [convParam, selectConversation, reset]);

  /** Run an SSE request and fold its events into the current conversation. */
  const run = useCallback(async (path: string, body: unknown, approval: boolean, convId: string, resume?: { key: string; trace: TraceEvent[] }) => {
    const key = resume?.key ?? nextKey();
    const initialTrace = resume?.trace ?? [];
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    setError(null);
    // Follow the live message and show its activity.
    setPanelMsg(null);
    setTab("activity");
    if (window.matchMedia("(min-width: 1180px)").matches) setPanelOpen(true);
    setLive("Working on your request");
    const fresh: UiMessage = {
      key, role: "assistant", text: "", citations: [], steps: [{ label: "Thinking", state: "run" }], trace: initialTrace, streaming: true, stopped: false,
    };
    setMessages((ms) =>
      resume && ms.some((m) => m.key === key)
        ? ms.map((m) => (m.key === key ? { ...m, streaming: true, steps: [...m.steps, fresh.steps[0] as UiMessage["steps"][number]] } : m))
        : [...ms, fresh],
    );
    const patch = (fn: (m: UiMessage) => UiMessage) => setMessages((ms) => ms.map((m) => (m.key === key ? fn(m) : m)));
    let outcome: "ok" | "error" | "stopped" = "ok";
    // A resumed (approval) stream continues the trace of the run that asked for approval.
    let collected = initialTrace;
    const offsets = offsetsAfter(initialTrace);
    // Tokens arrive far faster than the screen refreshes; buffer them and apply at most once per frame.
    let pendingText = "";
    let frame = 0;
    const flush = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (!pendingText) return;
      const chunk = pendingText;
      pendingText = "";
      patch((m) => ({ ...m, text: m.text + chunk }));
    };
    const onEvent = (e: ChatEvent) => {
      if (activeRef.current !== convId) return;
      switch (e.type) {
        case "status":
          patch((m) => ({
            ...m,
            steps: [...m.steps.map((s) => (s.state === "run" ? { ...s, state: "done" as const } : s)), { label: e.step, state: "run" }],
          }));
          break;
        case "trace": {
          const t = parseTraceEvent(e);
          if (!t) break;
          collected = mergeTrace(collected, t, offsets);
          const snapshot = collected;
          patch((m) => ({ ...m, trace: snapshot }));
          const added = snapshot.find((x) => x.seq === t.seq + offsets.seqOffset);
          if (added && (added.status === "blocked" || added.status === "waiting" || added.status === "error")) {
            setLive(`${added.title}: ${added.status === "waiting" ? "waiting for your approval" : added.status}`);
          }
          break;
        }
        case "token":
          pendingText += e.text;
          if (!frame) frame = requestAnimationFrame(flush);
          break;
        case "approval_required":
          approvalOrigins.current[e.action.id] = { key, trace: collected };
          setApprovals((a) => (a.some((x) => x.id === e.action.id) ? a : [...a, e.action]));
          break;
        case "final":
          pendingText = "";
          if (frame) cancelAnimationFrame(frame);
          frame = 0;
          patch((m) => ({ ...m, text: e.text, citations: e.citations ?? [] }));
          break;
        case "error": outcome = "error"; setError(e.message); break;
      }
    };
    try {
      await streamChat(path, body, onEvent, controller.signal);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") outcome = "stopped";
      else {
        outcome = "error";
        setError(errorText(e, approval));
      }
    } finally {
      flush();
      setMessages((ms) =>
        ms
          .map((m) =>
            m.key !== key
              ? m
              : {
                  ...m,
                  streaming: false,
                  stopped: outcome === "stopped",
                  steps:
                    outcome === "stopped"
                      ? m.steps.filter((s) => s.state !== "run")
                      : m.steps.map((s) => (s.state === "run" ? { ...s, state: outcome === "error" ? ("fail" as const) : ("done" as const) } : s)),
                },
          )
          .filter((m) => m.key !== key || m.text !== "" || m.trace.length > 0),
      );
      if (abortRef.current === controller) abortRef.current = null;
      setStreaming(false);
      setLive(outcome === "stopped" ? "Generation stopped" : outcome === "error" ? "Request failed" : "Answer ready");
    }
  }, []);

  const send = useCallback(
    async (override?: string) => {
      const text = (override ?? draft).trim();
      if (!text || streaming || text.length > MAX_LEN) return;
      setError(null);
      // Optimistic: show the question right away; creating the conversation (if needed) happens behind it.
      const userKey = nextKey();
      setDraft("");
      setMessages((m) => [...m, { key: userKey, role: "user", text, citations: [], steps: [], trace: [], streaming: false, stopped: false }]);
      let id = activeRef.current;
      if (!id) {
        try {
          const c = await api.createConversation();
          id = c.id;
          activeRef.current = id;
          add(c);
          router.replace(`/?c=${id}`);
        } catch (e) {
          setMessages((m) => m.filter((x) => x.key !== userKey));
          setDraft(text);
          setError(errorText(e, false));
          return;
        }
      }
      await run(`conversations/${id}/messages`, { text }, false, id);
      void refresh();
    },
    [draft, streaming, run, add, refresh, router],
  );

  const decide = useCallback(
    async (action: PendingAction, approve: boolean) => {
      const convId = activeRef.current;
      setReviewing(null);
      if (!convId) return;
      setApprovals((a) => a.filter((x) => x.id !== action.id));
      await run(`approvals/${action.id}`, { approve }, true, convId, approvalOrigins.current[action.id]);
    },
    [run],
  );

  const openCitation = useCallback((key: string, n: number) => {
    setPanelMsg(key);
    setPanelN(n);
    setTab("sources");
    setPanelOpen(true);
  }, []);

  const openActivity = useCallback((key: string) => {
    setPanelMsg(key);
    setTab("activity");
    setPanelOpen(true);
  }, []);

  const title = conversations.find((c) => c.id === convParam)?.title || (convParam ? "Conversation" : "New chat");
  const assistants = messages.filter((m) => m.role === "assistant");
  const panelMessage = messages.find((m) => m.key === panelMsg) ?? assistants[assistants.length - 1] ?? null;
  const mode: PanelMode = phone ? "dock" : wide ? "column" : "overlay";
  const isEmpty = messages.length === 0 && approvals.length === 0 && !streaming;

  return (
    <div className={`relative flex h-full ${phone ? "flex-col" : ""}`}>
      <section aria-label="Chat" className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
        <header className="flex h-14 flex-none items-center justify-between gap-3 border-b border-border px-5 max-sm:px-3">
          <h1 className="m-0 min-w-0 truncate text-sm font-semibold">{title}</h1>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setPanelOpen((o) => !o)}
            aria-expanded={panelOpen}
            aria-label={panelOpen ? "Hide agent activity" : "Show agent activity"}
            title={panelOpen ? "Hide agent activity" : "Show agent activity"}
          >
            <PanelRight size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[740px] flex-col gap-[30px] px-5 pb-6 pt-7 max-sm:px-3">
            {loadingConv && (
              <div role="status" aria-busy="true" className="flex flex-col gap-[30px]">
                <span className="sr-only">Loading conversation</span>
                <div className="flex flex-col items-end"><Skel className="h-10 w-1/2" /></div>
                <div className="flex flex-col gap-2.5">
                  <Skel className="h-[14px] w-full" />
                  <Skel className="h-[14px] w-5/6" />
                  <Skel className="h-[14px] w-2/3" />
                </div>
              </div>
            )}
            {isEmpty && !loadingConv && <Welcome onPick={(t) => void send(t)} disabled={streaming} />}
            {messages.map((m) => (
              <MessageView key={m.key} message={m} onOpenCitation={openCitation} onOpenActivity={openActivity} onAnnounce={setLive} />
            ))}
            {approvals.map((a) => (
              <ApprovalCard key={a.id} action={a} disabled={streaming} onReview={setReviewing} />
            ))}
            {error && (
              <div role="alert" className="flex items-start gap-3 rounded-[10px] border border-border bg-err-soft px-3.5 py-3">
                <TriangleAlert size={16} className="mt-px flex-none text-err" />
                <DobbyBurst size={36} mood="error" />
                <div className="flex flex-col gap-[3px] text-sm leading-normal">
                  <strong className="font-semibold">Something went wrong</strong>
                  <span className="text-muted">{error}</span>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>

        <Composer value={draft} onChange={setDraft} onSend={() => void send()} onStop={stop} streaming={streaming} />
        <div aria-live="polite" className="sr-only">
          {live}
        </div>
      </section>

      {panelOpen && (
        <ContextPanel
          message={panelMessage}
          focusN={panelN}
          messageCount={messages.length}
          approvals={approvals}
          mode={mode}
          tab={tab}
          onTab={setTab}
          trace={panelMessage?.trace ?? []}
          live={panelMessage?.streaming ?? false}
          onClose={() => setPanelOpen(false)}
        />
      )}

      {reviewing && (
        <ApprovalModal
          action={reviewing}
          busy={streaming}
          onApprove={(a) => void decide(a, true)}
          onReject={(a) => void decide(a, false)}
          onClose={() => setReviewing(null)}
        />
      )}
    </div>
  );
}
