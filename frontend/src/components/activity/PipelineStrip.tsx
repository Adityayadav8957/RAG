import { formatMs, type NodeView } from "@/lib/trace";
import { STATUS, StatusIcon } from "./status";

const BORDER: Record<string, string> = {
  pending: "border-border opacity-55",
  running: "border-accent bg-accent-soft",
  done: "border-border bg-surface",
  skipped: "border-dashed border-border-strong opacity-70",
  blocked: "border-err bg-err-soft",
  waiting: "border-warn bg-warn-soft",
  error: "border-err bg-err-soft",
};

/** Compact left-to-right mirror of the backend pipeline. Nodes that were not reached stay dim. */
export function PipelineStrip({ nodes }: { nodes: NodeView[] }) {
  return (
    <ol aria-label="Pipeline" className="m-0 flex list-none gap-1 overflow-x-auto p-0 pb-1">
      {nodes.map((n, i) => (
        <li key={n.key} className="flex flex-none items-center gap-1">
          <div
            className={`flex min-w-[68px] max-w-[88px] flex-col items-start gap-1 rounded-lg border px-2 py-1.5 transition-colors ${BORDER[n.state]}`}
          >
            <span className="flex w-full items-center justify-between gap-1">
              <StatusIcon state={n.state} />
              <span className="font-mono text-[10px] text-muted">{formatMs(n.ms)}</span>
            </span>
            <span className="text-[11px] font-medium leading-tight">{n.label}</span>
            <span className="sr-only">{STATUS[n.state].label}</span>
          </div>
          {i < nodes.length - 1 && <span aria-hidden="true" className="text-faint">›</span>}
        </li>
      ))}
    </ol>
  );
}
