"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorText } from "@/lib/api";
import { fetchUsers, USERS_KEY } from "@/lib/adminQueries";
import { useCachedFetch } from "@/lib/useCachedFetch";
import type { AuditEntry } from "@/lib/types";
import { LoaderCircle } from "../icons";
import { ErrorNote } from "../PageHeader";
import { TableSkeletonRows } from "../skeletons";

const SIZES = [10, 25, 50];

export function AuditLog() {
  const { data: users } = useCachedFetch(USERS_KEY, fetchUsers);
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [applied, setApplied] = useState("");
  const [size, setSize] = useState(25);
  // cursors[i] is the "before id" that opens page i; page 0 starts at the newest entry.
  const [cursors, setCursors] = useState<(number | undefined)[]>([undefined]);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const who = useMemo(() => new Map((users ?? []).map((u) => [u.id, u.email])), [users]);

  const load = useCallback(async (event: string, limit: number, beforeId?: number) => {
    setLoading(true);
    setError(null);
    try {
      const got = await api.audit({ event: event || undefined, limit: limit + 1, before_id: beforeId });
      setRows(got.slice(0, limit));
      setMore(got.length > limit);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
      setLoadedOnce(true);
    }
  }, []);

  useEffect(() => {
    void load("", 25);
  }, [load]);

  function restart(event: string, limit: number) {
    setCursors([undefined]);
    setPage(0);
    void load(event, limit);
  }

  function goNext() {
    const last = rows[rows.length - 1];
    if (!last) return;
    const next = [...cursors.slice(0, page + 1), last.id];
    setCursors(next);
    setPage(page + 1);
    void load(applied, size, last.id);
  }

  function goPrev() {
    if (page === 0) return;
    setPage(page - 1);
    void load(applied, size, cursors[page - 1]);
  }

  const first = page * size + 1;

  return (
    <section aria-labelledby="audit-h" className="flex flex-col gap-3">
      <div>
        <h2 id="audit-h" className="m-0 text-base font-semibold">Audit log</h2>
        <p className="m-0 mt-1 text-[13px] text-muted">An append-only record of sign-ins, uploads, approvals and admin changes in your workspace.</p>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(filter);
          restart(filter, size);
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
            <button type="button" className="btn btn-sm" disabled={loading} onClick={() => void load(applied, size, cursors[page])}>
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
            {loading && <TableSkeletonRows rows={5} cols={5} />}
            {rows.length === 0 && !loading && loadedOnce && !error && <tr><td colSpan={5} className="td text-muted">No entries.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="td whitespace-nowrap font-mono text-xs text-muted">{new Date(r.ts).toLocaleString()}</td>
                <td className="td font-medium">{r.event}</td>
                <td className="td text-xs [overflow-wrap:anywhere]" title={r.actor_id ?? undefined}>
                  {r.actor_id ? (who.get(r.actor_id) ?? <span className="font-mono">{r.actor_id.slice(0, 8)}</span>) : "-"}
                </td>
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
      <nav aria-label="Audit log pages" className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted">
        <span>{rows.length > 0 ? `Showing ${first}–${first + rows.length - 1}` : "\u00a0"}</span>
        <div className="flex items-center gap-2">
          <label htmlFor="audit-size" className="sr-only">Rows per page</label>
          <select
            id="audit-size"
            className="field h-8 w-auto py-0"
            value={size}
            disabled={loading}
            onChange={(e) => {
              const n = Number(e.target.value);
              setSize(n);
              restart(applied, n);
            }}
          >
            {SIZES.map((n) => <option key={n} value={n}>{n} per page</option>)}
          </select>
          <button type="button" className="btn btn-sm" disabled={loading || page === 0} onClick={goPrev}>Previous</button>
          <span className="min-w-12 text-center">Page {page + 1}</span>
          <button type="button" className="btn btn-sm" disabled={loading || !more} onClick={goNext}>Next</button>
        </div>
      </nav>
    </section>
  );
}
