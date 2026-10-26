"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { api, errorText } from "@/lib/api";
import type { JiraStatus } from "@/lib/types";
import { useCachedFetch } from "@/lib/useCachedFetch";
import { CircleCheck, Circle, LoaderCircle, TriangleAlert } from "../icons";
import { ErrorNote } from "../PageHeader";
import { Skel } from "../skeletons";

type View = { label: string; cls: string; icon: React.ReactNode };

function statusView(jira: JiraStatus | null, busy: boolean): View {
  if (busy) return { label: "Working…", cls: "bg-accent-soft text-accent-text", icon: <LoaderCircle size={14} className="spin" /> };
  if (!jira) return { label: "Checking…", cls: "bg-subtle text-muted", icon: <LoaderCircle size={14} className="spin" /> };
  if (!jira.configured) return { label: "Not configured", cls: "bg-warn-soft text-warn", icon: <TriangleAlert size={14} /> };
  if (jira.connected) return { label: "Connected", cls: "bg-ok-soft text-ok", icon: <CircleCheck size={14} /> };
  return { label: "Not connected", cls: "bg-subtle text-muted", icon: <Circle size={14} /> };
}

export function ToolsSection() {
  const params = useSearchParams();
  const result = params.get("jira");
  const { data: jira = null, error: loadError, loading, validating, refresh } = useCachedFetch("integrations/jira", api.jira, { staleMs: 5_000 });
  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError ?? (loadError ? errorText(loadError) : null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function connect() {
    setBusy(true);
    setActionError(null);
    try {
      const { url } = await api.jiraConnect();
      window.location.assign(url);
    } catch (e) {
      setActionError(errorText(e));
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    setActionError(null);
    try {
      await api.jiraDisconnect();
      setConfirming(false);
      await refresh();
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const view = statusView(jira, busy);
  return (
    <div className="flex flex-col gap-4">
      {result === "connected" && <p role="status" className="m-0 rounded-[10px] bg-ok-soft px-3.5 py-3 text-[13px] text-ok">Jira connected successfully.</p>}
      {result === "error" && <ErrorNote>Jira connection failed. Please try again.</ErrorNote>}
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
      {loading && !loadError ? (
        <div role="status" aria-busy="true" className="grid grid-cols-[40px_minmax(0,1fr)] items-start gap-3.5 rounded-xl border border-border bg-surface px-[18px] py-4">
          <span className="sr-only">Loading connected tools</span>
          <Skel className="h-10 w-10 !rounded-[9px]" />
          <div className="flex flex-col gap-2.5">
            <Skel className="h-[15px] w-32" />
            <Skel className="h-[13px] w-full max-w-md" />
          </div>
        </div>
      ) : (
      <section aria-labelledby="jira-h" className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-start gap-3.5 rounded-xl border border-border bg-surface px-[18px] py-4 max-sm:grid-cols-[40px_minmax(0,1fr)]">
        <div className="grid h-10 w-10 place-items-center rounded-[9px] border border-border text-xs font-semibold text-muted">JR</div>
        <div className="flex min-w-0 flex-col gap-[7px]">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 id="jira-h" className="m-0 text-[15px] font-semibold">Jira</h2>
            <span className={`badge ${view.cls}`} role="status">
              {view.icon}
              {view.label}
            </span>
          </div>
          <span className="text-[13px] text-muted">
            {jira && !jira.configured
              ? "The Jira integration is not configured on this server. Ask an administrator to set it up."
              : "Lets the assistant create and update issues as you, only after you approve each change."}
          </span>
          {jira?.connected && jira.site_url && <span className="text-xs text-faint [overflow-wrap:anywhere]">Site: {jira.site_url}</span>}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5 max-sm:col-span-2 max-sm:justify-start">
          {jira?.configured && !jira.connected && (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void connect()}>
              Connect Jira
            </button>
          )}
          {jira?.connected && !confirming && (
            <button type="button" className="btn btn-sm btn-quiet btn-quiet-danger" disabled={busy} onClick={() => setConfirming(true)}>
              Disconnect
            </button>
          )}
          {jira?.connected && confirming && (
            <>
              <span className="text-xs text-muted">Disconnect Jira?</span>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setConfirming(false)}>
                Keep
              </button>
              <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void disconnect()}>
                Disconnect
              </button>
            </>
          )}
        </div>
      </section>
      )}
      <p className="m-0 text-xs text-faint">Jira is the only connected tool available right now. Credentials are never shown here.</p>
    </div>
  );
}
