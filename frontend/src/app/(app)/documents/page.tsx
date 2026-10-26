"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { api, errorText } from "@/lib/api";
import { useCachedFetch } from "@/lib/useCachedFetch";
import { canUpload, type DocumentItem, type DocStatus } from "@/lib/types";
import { FileText, LoaderCircle, Lock, Search, Trash2, TriangleAlert, CircleCheck, Upload } from "@/components/icons";
import { ErrorNote, PageHeader } from "@/components/PageHeader";
import { TableSkeletonRows } from "@/components/skeletons";
import { useUser } from "@/components/UserProvider";

type Filter = "all" | "ready" | "processing" | "failed";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "ready", label: "Indexed" },
  { id: "processing", label: "In progress" },
  { id: "failed", label: "Failed" },
];

// Dialogs are only needed after a click, so they stay out of the page's first-load JS.
const UploadDialog = dynamic(() => import("@/components/UploadDialog").then((m) => m.UploadDialog), { ssr: false });
const AclDialog = dynamic(() => import("@/components/AclDialog").then((m) => m.AclDialog), { ssr: false });

function ext(filename: string): string {
  const i = filename.lastIndexOf(".");
  return (i >= 0 ? filename.slice(i + 1) : "file").toUpperCase().slice(0, 4);
}

function StatusCell({ status, error }: { status: DocStatus; error: string | null }) {
  const view = {
    ready: { label: "Indexed", cls: "text-ok", icon: <CircleCheck size={16} /> },
    processing: { label: "Processing", cls: "text-accent-text", icon: <LoaderCircle size={16} className="spin" /> },
    failed: { label: "Failed", cls: "text-err", icon: <TriangleAlert size={16} /> },
  }[status];
  return (
    <div className="flex min-w-[120px] flex-col gap-1">
      <span className={`flex items-center gap-1.5 font-medium ${view.cls}`}>
        {view.icon}
        {view.label}
      </span>
      {status === "failed" && error && <span className="text-xs text-muted">{error}</span>}
    </div>
  );
}

export default function DocumentsPage() {
  const { user } = useUser();
  const { data: docs, error: loadError, loading, validating, refresh, mutate } = useCachedFetch("documents", api.listDocuments);
  const [actionError, setActionError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<DocumentItem | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [live, setLive] = useState("");
  const error = actionError ?? (loadError ? errorText(loadError) : null);

  const anyProcessing = docs?.some((d) => d.status === "processing") ?? false;
  useEffect(() => {
    if (!anyProcessing) return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [anyProcessing, refresh]);

  async function remove(d: DocumentItem) {
    if (!window.confirm(`Delete "${d.title}"? This cannot be undone.`)) return;
    setActionError(null);
    setRemoving((r) => new Set(r).add(d.id));
    try {
      await api.deleteDocument(d.id);
      mutate((x) => x?.filter((y) => y.id !== d.id));
      setLive(`${d.title} removed`);
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setRemoving((r) => {
        const n = new Set(r);
        n.delete(d.id);
        return n;
      });
    }
  }

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: docs?.length ?? 0, ready: 0, processing: 0, failed: 0 };
    docs?.forEach((d) => (c[d.status] += 1));
    return c;
  }, [docs]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (docs ?? []).filter(
      (d) => (filter === "all" || d.status === filter) && (!q || d.title.toLowerCase().includes(q) || d.filename.toLowerCase().includes(q)),
    );
  }, [docs, query, filter]);

  const access = (d: DocumentItem) =>
    d.visibility === "all" ? "Everyone" : `Restricted${d.allowed_roles.length ? `: ${d.allowed_roles.join(", ")}` : ""}`;

  return (
    <div className="mx-auto flex max-w-[1080px] flex-col gap-5 px-6 pb-12 pt-7 max-sm:px-3">
      <PageHeader title="Knowledge base" description="Documents the assistant can cite. Only documents you're allowed to see are listed.">
        {canUpload(user) && (
          <button type="button" className="btn btn-primary" onClick={() => setUploadOpen(true)}>
            <Upload size={16} />
            Upload document
          </button>
        )}
      </PageHeader>

      {error && (
        <ErrorNote>
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <button type="button" className="btn btn-sm" disabled={validating} onClick={() => { setActionError(null); void refresh(); }}>
              {validating && <LoaderCircle size={14} className="spin" />}
              Retry
            </button>
          </span>
        </ErrorNote>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-muted focus-within:border-accent">
          <Search size={16} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search documents"
            placeholder="Search documents"
            className="min-w-0 flex-1 border-none bg-transparent text-[13px] outline-none focus-visible:outline-none"
          />
        </label>
        <div role="group" aria-label="Filter by status" className="flex gap-1 overflow-x-auto rounded-lg bg-subtle p-[3px]">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`h-[30px] whitespace-nowrap rounded-md border-none px-2.5 text-xs font-medium ${
                filter === f.id ? "bg-surface text-ink" : "bg-transparent text-muted"
              }`}
            >
              {f.label} <span className="text-faint">{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table aria-busy={loading} className="w-full min-w-[820px] border-collapse text-[13px]">
          <caption className="sr-only">Documents</caption>
          <thead>
            <tr>
              <th scope="col" className="th">Document</th>
              <th scope="col" className="th">Status</th>
              <th scope="col" className="th !text-right">Chunks</th>
              <th scope="col" className="th">Added</th>
              <th scope="col" className="th">Owner</th>
              <th scope="col" className="th">Access</th>
              <th scope="col" className="th"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && !loadError && <TableSkeletonRows rows={6} cols={7} />}
            {shown.map((d) => {
              const mine = user?.id === d.owner_id;
              const canManage = mine || (user?.roles.includes("admin") ?? false);
              return (
                <tr key={d.id}>
                  <td className="td">
                    <div className="flex items-center gap-2.5">
                      <span className="w-[34px] flex-none rounded border border-border py-0.5 text-center font-mono text-[10px] font-medium text-muted">
                        {ext(d.filename)}
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium [overflow-wrap:anywhere]">{d.title}</div>
                        {d.title !== d.filename && <div className="text-xs text-faint [overflow-wrap:anywhere]">{d.filename}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="td"><StatusCell status={d.status} error={d.error} /></td>
                  <td className={`td text-right font-mono text-xs ${d.status === "ready" ? "" : "text-faint"}`}>
                    {d.status === "ready" ? d.chunk_count : "—"}
                  </td>
                  <td className="td whitespace-nowrap text-muted">{new Date(d.created_at).toLocaleString()}</td>
                  <td className="td whitespace-nowrap">{mine ? "You" : "Another user"}</td>
                  <td className="td">
                    <span className="badge">
                      <Lock size={12} />
                      {access(d)}
                    </span>
                  </td>
                  <td className="td">
                    {canManage && (
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" className="btn btn-sm font-medium" onClick={() => setEditing(d)} aria-label={`Edit access for ${d.title}`}>
                          Access
                        </button>
                        <button
                          type="button"
                          className="icon-btn icon-btn-danger text-faint"
                          onClick={() => void remove(d)}
                          disabled={removing.has(d.id)}
                          aria-label={`Delete ${d.title}`}
                          title="Delete"
                        >
                          {removing.has(d.id) ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {docs !== undefined && shown.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 px-5 py-10 text-center">
            <FileText size={22} className="text-faint" />
            <span className="text-sm font-semibold">No documents found</span>
            <span className="text-[13px] text-muted">
              {docs.length === 0 ? "No documents are available to you yet." : "Try a different search or filter."}
            </span>
          </div>
        )}
      </div>
      <p className="m-0 text-xs text-faint">“Indexed” is shown only after the ingestion service confirms completion.</p>
      <div aria-live="polite" className="sr-only">{live}</div>

      {uploadOpen && (
        <UploadDialog
          onClose={() => setUploadOpen(false)}
          onUploaded={() => {
            setUploadOpen(false);
            setFilter("all");
            setLive("Document uploaded");
            void refresh();
          }}
        />
      )}
      {editing && (
        <AclDialog
          doc={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}
