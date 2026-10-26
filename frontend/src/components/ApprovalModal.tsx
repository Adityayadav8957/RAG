"use client";

import type { PendingAction } from "@/lib/types";
import { formatRemaining, useRemaining } from "@/lib/useRemaining";
import { DobbyMark } from "./DobbyMark";
import { Modal } from "./Modal";
import { LoaderCircle, ShieldCheck } from "./icons";

function display(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "—";
  return JSON.stringify(v);
}

export function ApprovalModal({
  action, busy, onApprove, onReject, onClose,
}: {
  action: PendingAction;
  busy: boolean;
  onApprove: (a: PendingAction) => void;
  onReject: (a: PendingAction) => void;
  onClose: () => void;
}) {
  const secs = useRemaining(action.expires_at);
  const expired = secs <= 0;
  const rows = Object.entries(action.arguments);
  return (
    <Modal titleId="appr-title" onClose={onClose} maxWidth="32.5rem" dismissible={!busy}>
      <div className="flex flex-col gap-1.5 px-[22px] pb-3.5 pt-5">
        <DobbyMark size={52} mood="waiting" />
        <span className="flex items-center gap-1.5 text-xs font-semibold text-warn">
          <ShieldCheck size={14} />
          Confirmation required · write action
        </span>
        <h2 id="appr-title" className="m-0 text-lg font-semibold tracking-[-0.01em]">
          {action.summary}
        </h2>
        <span className="text-[13px] text-muted">
          Tool: <strong className="font-semibold text-ink">{action.tool}</strong> · runs as you
        </span>
      </div>
      <div className="px-[22px]">
        {rows.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th scope="col" className="bg-subtle px-2.5 py-2 text-left font-semibold text-muted">Field</th>
                  <th scope="col" className="bg-subtle px-2.5 py-2 text-left font-semibold text-muted">Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([k, v]) => (
                  <tr key={k}>
                    <td className="border-t border-border px-2.5 py-2 align-top text-muted">{k}</td>
                    <td className="border-t border-border px-2.5 py-2 align-top font-semibold [overflow-wrap:anywhere]">
                      <span className={typeof v === "string" ? "" : "font-mono text-xs"}>{display(v)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="m-0 text-[13px] text-muted">This action has no arguments.</p>
        )}
      </div>
      <p className="mx-[22px] mt-3.5 text-[13px] leading-normal text-muted">
        Nothing is changed until you approve. Rejecting discards the action.
      </p>
      <div className="mx-[22px] mt-3.5 flex flex-col gap-[3px] rounded-lg bg-subtle px-3 py-2.5 font-mono text-[11.5px] text-muted">
        <span className="[overflow-wrap:anywhere]">operation_id: {action.id}</span>
        <span>{expired ? "expired" : `expires in ${formatRemaining(secs)}`}</span>
      </div>
      <div className="flex justify-end gap-2 px-[22px] pb-5 pt-[18px]">
        <button type="button" className="btn" disabled={busy || expired} onClick={() => onReject(action)}>
          Reject
        </button>
        <button type="button" className="btn btn-primary" disabled={busy || expired} onClick={() => onApprove(action)}>
          {busy && <LoaderCircle size={14} className="spin" />}
          {busy ? "Working…" : "Approve change"}
        </button>
      </div>
    </Modal>
  );
}
