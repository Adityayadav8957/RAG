"use client";

import type { PendingAction } from "@/lib/types";
import { formatRemaining, useRemaining } from "@/lib/useRemaining";
import { Clock, TriangleAlert } from "./icons";

function toolBadge(tool: string): string {
  return tool.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "AC";
}

/** Inline summary of a pending write action; the full review happens in ApprovalModal. */
export function ApprovalCard({
  action, disabled, onReview,
}: {
  action: PendingAction;
  disabled: boolean;
  onReview: (action: PendingAction) => void;
}) {
  const secs = useRemaining(action.expires_at);
  const expired = secs <= 0;
  return (
    <section aria-label="Approval required" className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid h-7 w-7 flex-none place-items-center rounded-[7px] border border-border text-[11px] font-semibold text-muted">
            {toolBadge(action.tool)}
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-semibold [overflow-wrap:anywhere]">{action.summary}</span>
            <span className="truncate font-mono text-xs text-faint">{action.tool}</span>
          </div>
        </div>
        <span
          className={`inline-flex flex-none items-center gap-1.5 rounded-md px-2 py-[3px] text-xs font-semibold ${
            expired ? "bg-err-soft text-err" : "bg-warn-soft text-warn"
          }`}
        >
          {expired ? <TriangleAlert size={14} /> : <Clock size={14} />}
          {expired ? "Expired" : "Awaiting approval"}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 text-[13px] text-muted">
        <span>{expired ? "This action expired. Ask again to retry." : `Nothing changes until you approve · expires in ${formatRemaining(secs)}`}</span>
        {!expired && (
          <button type="button" className="btn btn-primary btn-sm" disabled={disabled} onClick={() => onReview(action)}>
            Review &amp; approve
          </button>
        )}
      </div>
    </section>
  );
}
