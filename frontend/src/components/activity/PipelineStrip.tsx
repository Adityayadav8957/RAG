"use client";

import { useEffect, useState } from "react";
import { formatMs, type NodeView } from "@/lib/trace";
import { ChevronDown, ChevronUp } from "../icons";
import { STATUS, StatusIcon } from "./status";

type Layout = "strip" | "list";
const LAYOUT_KEY = "activity.pipelineLayout";

const STRIP_BORDER: Record<string, string> = {
  pending: "border-border opacity-55",
  running: "border-accent bg-accent-soft",
  done: "border-border bg-surface",
  skipped: "border-dashed border-border-strong opacity-70",
  blocked: "border-err bg-err-soft",
  waiting: "border-warn bg-warn-soft",
  error: "border-err bg-err-soft",
};

const LIST_TONE: Record<string, string> = {
  pending: "opacity-50",
  running: "bg-accent-soft",
  done: "",
  skipped: "opacity-70",
  blocked: "bg-err-soft",
  waiting: "bg-warn-soft",
  error: "bg-err-soft",
};

/** The step to headline: whatever is running or waiting, otherwise the last one that was reached. */
function currentNode(nodes: NodeView[]): NodeView | undefined {
  const active = nodes.find((n) => n.state === "running" || n.state === "waiting" || n.state === "blocked" || n.state === "error");
  if (active) return active;
  return [...nodes].reverse().find((n) => n.state === "done") ?? nodes[0];
}

function Strip({ nodes }: { nodes: NodeView[] }) {
  return (
    <ol aria-label="Pipeline" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {nodes.map((n) => (
        <li key={n.key} className={`flex min-w-[88px] flex-1 flex-col items-start gap-1 rounded-lg border px-2 py-1.5 transition-colors ${STRIP_BORDER[n.state]}`}>
          <span className="flex w-full items-center justify-between gap-1">
            <StatusIcon state={n.state} />
            <span className="font-mono text-[10px] text-muted">{formatMs(n.ms)}</span>
          </span>
          <span className="text-[11px] font-medium leading-tight">{n.label}</span>
          <span className="sr-only">{STATUS[n.state].label}</span>
        </li>
      ))}
    </ol>
  );
}

function List({ nodes }: { nodes: NodeView[] }) {
  return (
    <ol aria-label="Pipeline" className="m-0 flex list-none flex-col overflow-hidden rounded-lg border border-border bg-surface p-0">
      {nodes.map((n) => (
        <li key={n.key} className={`flex items-center gap-2.5 border-b border-border px-3 py-2 last:border-b-0 transition-colors ${LIST_TONE[n.state]}`}>
          <StatusIcon state={n.state} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{n.label}</span>
          <span className="text-xs text-muted">{STATUS[n.state].label}</span>
          <span className="w-14 text-right font-mono text-[11px] tabular-nums text-faint">{n.ms === null ? "" : formatMs(n.ms)}</span>
        </li>
      ))}
    </ol>
  );
}

/** Collapsed: the step in progress. Expanded: every stage, as wrapped tiles or a list (choice is remembered). */
export function PipelineStrip({ nodes }: { nodes: NodeView[] }) {
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState<Layout>("strip");
  useEffect(() => {
    try {
      if (localStorage.getItem(LAYOUT_KEY) === "list") setLayout("list");
    } catch {
      /* storage unavailable: keep the default */
    }
  }, []);
  function pick(l: Layout) {
    setLayout(l);
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {
      /* ignore */
    }
  }
  const cur = currentNode(nodes);
  const done = nodes.filter((n) => n.state === "done" || n.state === "skipped").length;
  return (
    <section aria-label="Pipeline progress" className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 rounded-lg border-none bg-transparent px-2 py-1.5 text-left hover:bg-subtle"
      >
        {cur && <StatusIcon state={cur.state} />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{cur?.label ?? "Pipeline"}</span>
          <span className="block text-[11px] text-muted">
            {cur ? STATUS[cur.state].label : ""} · {done} of {nodes.length} stages
          </span>
        </span>
        {cur?.ms != null && <span className="font-mono text-[11px] tabular-nums text-faint">{formatMs(cur.ms)}</span>}
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-1 pb-1">
          <div role="group" aria-label="Layout" className="flex gap-1 self-end">
            {(["strip", "list"] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={layout === l}
                onClick={() => pick(l)}
                className={`btn btn-sm ${layout === l ? "btn-primary" : ""}`}
              >
                {l === "strip" ? "Tiles" : "List"}
              </button>
            ))}
          </div>
          {layout === "strip" ? <Strip nodes={nodes} /> : <List nodes={nodes} />}
        </div>
      )}
    </section>
  );
}
