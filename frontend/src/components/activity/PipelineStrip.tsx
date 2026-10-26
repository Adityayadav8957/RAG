import { formatMs, type NodeView } from "@/lib/trace";
import { STATUS, StatusIcon } from "./status";

const TONE: Record<string, string> = {
  pending: "opacity-50",
  running: "bg-accent-soft",
  done: "",
  skipped: "opacity-70",
  blocked: "bg-err-soft",
  waiting: "bg-warn-soft",
  error: "bg-err-soft",
};

/** The backend pipeline as a vertical stepper: one readable row per stage. Stages not reached stay dim. */
export function PipelineStrip({ nodes }: { nodes: NodeView[] }) {
  return (
    <ol aria-label="Pipeline" className="m-0 flex list-none flex-col overflow-hidden rounded-xl border border-border bg-surface p-0">
      {nodes.map((n) => (
        <li key={n.key} className={`flex items-center gap-2.5 border-b border-border px-3 py-2 last:border-b-0 transition-colors ${TONE[n.state]}`}>
          <StatusIcon state={n.state} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{n.label}</span>
          <span className="text-xs text-muted">{STATUS[n.state].label}</span>
          <span className="w-14 text-right font-mono text-[11px] tabular-nums text-faint">{n.ms === null ? "" : formatMs(n.ms)}</span>
        </li>
      ))}
    </ol>
  );
}
