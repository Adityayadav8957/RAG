"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import type { PendingAction, TraceEvent } from "@/lib/types";
import { Activity, BookOpen, X } from "../icons";
import { Skel } from "../skeletons";
import type { UiMessage } from "./types";

// The activity view (pipeline, trace cards) is only needed once the panel's Activity tab is opened.
const ActivityTab = dynamic(() => import("../activity/ActivityTab").then((m) => m.ActivityTab), {
  ssr: false,
  loading: () => (
    <div role="status" aria-busy="true" className="flex flex-col gap-2.5">
      <span className="sr-only">Loading activity</span>
      <Skel className="h-[60px] w-full !rounded-[10px]" />
      <Skel className="h-[60px] w-full !rounded-[10px]" />
    </div>
  ),
});

export type PanelTab = "sources" | "activity";
const TABS: { id: PanelTab; label: string }[] = [
  { id: "sources", label: "Sources" },
  { id: "activity", label: "Activity" },
];

export type PanelMode = "column" | "overlay" | "sheet";

function SourcesTab({
  message, focusN, messageCount, approvals,
}: { message: UiMessage | null; focusN: number | null; messageCount: number; approvals: PendingAction[] }) {
  const sources = message?.citations ?? [];
  return (
    <div className="flex flex-col gap-6">
      {sources.length === 0 && approvals.length === 0 && (
        <p className="m-0 text-[13px] leading-[1.55] text-muted">Sources and pending actions for an answer will appear here.</p>
      )}
      {sources.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h3 className="m-0 text-xs font-semibold text-faint">Sources</h3>
          {sources.map((s) => (
            <div key={s.n} className={`flex flex-col gap-2 rounded-[10px] border bg-surface p-3 ${focusN === s.n ? "border-accent" : "border-border"}`}>
              <div className="flex items-start gap-2.5">
                <span className="grid h-5 w-5 flex-none place-items-center rounded-[5px] bg-accent-soft text-[11px] font-semibold text-accent-text">{s.n}</span>
                <span className="text-[13px] font-semibold leading-[1.35]">{s.title}</span>
              </div>
              <p className="m-0 border-l-2 border-border-strong pl-2.5 text-[13px] leading-[1.55] text-muted [text-wrap:pretty]">{s.excerpt}</p>
            </div>
          ))}
        </section>
      )}
      {approvals.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-xs font-semibold text-faint">Pending actions</h3>
          {approvals.map((a) => (
            <div key={a.id} className="flex flex-col gap-0.5 text-[13px]">
              <span>{a.summary}</span>
              <span className="font-mono text-xs text-faint">{a.tool}</span>
            </div>
          ))}
        </section>
      )}
      <section className="flex flex-col gap-2">
        <h3 className="m-0 text-xs font-semibold text-faint">Conversation</h3>
        <div className="flex justify-between gap-3 text-[13px]">
          <span className="text-muted">Messages</span>
          <span>{messageCount}</span>
        </div>
      </section>
    </div>
  );
}

export function ContextPanel({
  message, focusN, messageCount, approvals, mode, tab, onTab, trace, live, onClose,
}: {
  message: UiMessage | null;
  focusN: number | null;
  messageCount: number;
  approvals: PendingAction[];
  mode: PanelMode;
  tab: PanelTab;
  onTab: (t: PanelTab) => void;
  trace: TraceEvent[];
  live: boolean;
  onClose: () => void;
}) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (mode === "column") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  function onTabKey(e: React.KeyboardEvent, i: number) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + TABS.length) % TABS.length;
    const t = TABS[next];
    if (t) onTab(t.id);
    tabRefs.current[next]?.focus();
  }

  const frame =
    mode === "sheet"
      ? "fixed inset-x-0 bottom-0 z-[41] max-h-[82dvh] rounded-t-2xl border-t shadow-pop"
      : mode === "overlay"
        ? "absolute inset-y-0 right-0 z-[21] w-[min(420px,92vw)] border-l shadow-pop"
        : "relative inset-y-0 w-[400px] flex-none border-l";

  return (
    <>
      {mode !== "column" && (
        <div aria-hidden="true" onClick={onClose} className={`${mode === "sheet" ? "fixed z-40" : "absolute z-20"} inset-0 bg-[var(--scrim)]`} />
      )}
      <aside aria-label="Agent activity and sources" className={`${frame} flex flex-col overflow-hidden border-border bg-surface`}>
        <div className="flex h-14 flex-none items-center justify-between gap-2 border-b border-border pl-3 pr-3">
          <div role="tablist" aria-label="Panel view" className="flex gap-1 rounded-lg bg-subtle p-[3px]">
            {TABS.map((t, i) => {
              const active = tab === t.id;
              const Icon = t.id === "activity" ? Activity : BookOpen;
              return (
                <button
                  key={t.id}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`panel-tab-${t.id}`}
                  aria-selected={active}
                  aria-controls="panel-body"
                  tabIndex={active ? 0 : -1}
                  onClick={() => onTab(t.id)}
                  onKeyDown={(e) => onTabKey(e, i)}
                  className={`flex h-[30px] items-center gap-1.5 rounded-md border-none px-3 text-[13px] font-medium ${active ? "bg-surface text-ink" : "bg-transparent text-muted"}`}
                >
                  <Icon size={14} />
                  {t.label}
                  {t.id === "activity" && live && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />}
                </button>
              );
            })}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close panel">
            <X size={16} />
          </button>
        </div>
        <div id="panel-body" role="tabpanel" aria-labelledby={`panel-tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4">
          {tab === "activity" ? <ActivityTab trace={trace} live={live} /> : <SourcesTab message={message} focusN={focusN} messageCount={messageCount} approvals={approvals} />}
        </div>
      </aside>
    </>
  );
}
