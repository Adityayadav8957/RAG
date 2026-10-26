"use client";

import { useState } from "react";
import { formatMs, stageNode, type NodeView } from "@/lib/trace";
import type { TraceEvent } from "@/lib/types";
import { ChevronDown, ChevronUp } from "../icons";
import { STATUS, StatusIcon } from "./status";
import { TraceCard } from "./TraceCard";

const TONE: Record<string, string> = {
  pending: "opacity-55",
  running: "border-accent bg-accent-soft",
  done: "",
  skipped: "opacity-75",
  blocked: "border-err bg-err-soft",
  waiting: "border-warn bg-warn-soft",
  error: "border-err bg-err-soft",
};

const ACTIVE = new Set(["running", "waiting", "blocked", "error"]);

/**
 * One list for the whole run: a row per pipeline stage with its status and time, opening into that
 * stage's detailed steps. Stages that are running or need attention open by themselves.
 */
export function StageList({ nodes, events, live }: { nodes: NodeView[]; events: TraceEvent[]; live: boolean }) {
  const [override, setOverride] = useState<Record<string, boolean>>({});
  const finalEvents = events.filter((e) => stageNode(e.stage) === null);
  const rows = nodes.map((n) => ({ ...n, events: events.filter((e) => stageNode(e.stage) === n.key) }));
  const isOpen = (key: string, state: string) => override[key] ?? ACTIVE.has(state);
  const expandable = rows.filter((r) => r.events.length > 0);
  const allOpen = expandable.length > 0 && expandable.every((r) => isOpen(r.key, r.state));

  return (
    <section aria-label="Agent activity" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-xs font-semibold text-faint">Pipeline</h3>
        <button
          type="button"
          className="border-none bg-transparent p-0 text-xs text-muted hover:text-ink"
          onClick={() => setOverride(Object.fromEntries(expandable.map((r) => [r.key, !allOpen])))}
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {rows.map((r) => {
          const open = isOpen(r.key, r.state);
          const can = r.events.length > 0;
          const head = (
            <>
              <StatusIcon state={r.state} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{r.label}</span>
              <span className="text-xs text-muted">{STATUS[r.state].label}</span>
              <span className="w-14 text-right font-mono text-[11px] tabular-nums text-faint">{r.ms === null ? "" : formatMs(r.ms)}</span>
              {can ? open ? <ChevronUp size={15} className="text-faint" /> : <ChevronDown size={15} className="text-faint" /> : <span className="w-[15px]" />}
            </>
          );
          return (
            <li key={r.key} className={`overflow-hidden rounded-xl border border-border bg-surface transition-colors ${TONE[r.state]}`}>
              {can ? (
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOverride((o) => ({ ...o, [r.key]: !open }))}
                  className="flex w-full items-center gap-2.5 border-none bg-transparent px-3 py-2.5 text-left hover:bg-subtle"
                >
                  {head}
                </button>
              ) : (
                <div className="flex items-center gap-2.5 px-3 py-2.5">{head}</div>
              )}
              {can && open && (
                <ol className="m-0 flex list-none flex-col gap-2 border-t border-border bg-subtle p-2">
                  {r.events.map((e) => (
                    <TraceCard key={e.seq} event={e} animate={live} />
                  ))}
                </ol>
              )}
            </li>
          );
        })}
        {finalEvents.map((e) => (
          <TraceCard key={e.seq} event={e} animate={live} />
        ))}
      </ol>
    </section>
  );
}
