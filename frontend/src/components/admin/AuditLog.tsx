"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "@/lib/api";
import type { AuditEntry } from "@/lib/types";
import { LoaderCircle } from "../icons";
import { ErrorNote } from "../PageHeader";
import { TableSkeletonRows } from "../skeletons";

const PAGE = 50;

export function AuditLog() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [applied, setApplied] = useState("");
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (event: string, beforeId?: number) => {
    setLoading(true);
    setError(null);
    try {
      const page = await api.audit({ event: event || undefined, limit: PAGE, before_id: beforeId });
      setRows((r) => (beforeId === undefined ? page : [...r, ...page]));
      setMore(page.length === PAGE);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
      setLoadedOnce(true);
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  return (
    <section aria-labelledby="audit-h" className="flex flex-col gap-3">
      <h2 id="audit-h" className="m-0 text-base font-semibold">Audit log</h2>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(filter);
          void load(filter);
        }}
      >
        <div className="min-w-[220px] flex-1 sm:max-w-xs">
          <label htmlFor="evt" className="mb-1 block text-[13px] font-medium">Event</label>
          <input id="evt" className="field" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="e.g. document.delete" />
        </div>
        <button type="submit" className="btn" disabled={loading}>Filter</button>
      </form>
      {error && (
        <ErrorNote>
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <button type="button" className="btn btn-sm" disabled={loading} onClick={() => void load(applied)}>
              {loading && <LoaderCircle size={14} className="spin" />}
              Retry
            </button>
          </span>
        </ErrorNote>
      )}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table aria-busy={loading} className="w-full min-w-[720px] border-collapse text-[13px]">
          <caption className="sr-only">Audit log</caption>
          <thead>
            <tr>
              <th scope="col" className="th">Time</th>
              <th scope="col" className="th">Event</th>
              <th scope="col" className="th">Actor</th>
              <th scope="col" className="th">Resource</th>
              <th scope="col" className="th">Details</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && <TableSkeletonRows rows={5} cols={5} />}
            {rows.length === 0 && !loading && loadedOnce && !error && <tr><td colSpan={5} className="td text-muted">No entries.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="td whitespace-nowrap font-mono text-xs text-muted">{new Date(r.ts).toLocaleString()}</td>
                <td className="td font-medium">{r.event}</td>
                <td className="td font-mono text-xs [overflow-wrap:anywhere]">{r.actor_id ?? "-"}</td>
                <td className="td font-mono text-xs [overflow-wrap:anywhere]">{r.resource ?? "-"}</td>
                <td className="td">
                  {r.details && Object.keys(r.details).length > 0 ? (
                    <details>
                      <summary className="cursor-pointer text-xs text-muted">View</summary>
                      <pre className="mt-1 max-w-xs overflow-auto rounded-md bg-subtle p-2 font-mono text-xs">{JSON.stringify(r.details, null, 2)}</pre>
                    </details>
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more && (
        <div>
          <button type="button" className="btn" disabled={loading} onClick={() => void load(applied, rows[rows.length - 1]?.id)}>
            {loading && <LoaderCircle size={14} className="spin" />}
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </section>
  );
}
