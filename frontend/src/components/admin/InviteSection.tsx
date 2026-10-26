"use client";

import { useEffect, useState } from "react";
import { api, errorText } from "@/lib/api";
import { fetchInvites, INVITES_KEY } from "@/lib/adminQueries";
import { KNOWN_ROLES, ROLE_DESCRIPTIONS, type Invitation } from "@/lib/types";
import { useCachedFetch } from "@/lib/useCachedFetch";
import { Check, Copy, LoaderCircle } from "../icons";
import { ErrorNote } from "../PageHeader";
import { TableSkeletonRows } from "../skeletons";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteSection() {
  const { data: invites, error: loadError, loading, validating, refresh, mutate } = useCachedFetch(INVITES_KEY, fetchInvites);
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<string[]>(["employee"]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [revoking, setRevoking] = useState<Set<string>>(new Set());
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => setOrigin(window.location.origin), []);

  function toggle(role: string, on: boolean) {
    setRoles((r) => (on ? [...r, role] : r.filter((x) => x !== role)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const addr = email.trim();
    if (!EMAIL_RE.test(addr)) return setFormError("Enter a valid email address.");
    if (roles.length === 0) return setFormError("Choose at least one role.");
    setFormError(null);
    setSubmitting(true);
    try {
      const inv = await api.invite(addr, roles);
      mutate((list) => [inv, ...(list ?? []).filter((x) => x.id !== inv.id)]);
      setEmail("");
      setNote(`Invitation created for ${inv.email}`);
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(inv: Invitation) {
    if (!window.confirm(`Revoke the invitation for ${inv.email}?`)) return;
    setListError(null);
    setRevoking((s) => new Set(s).add(inv.id));
    try {
      await api.revokeInvitation(inv.id);
      mutate((list) => list?.filter((x) => x.id !== inv.id));
      setNote(`Invitation for ${inv.email} revoked`);
    } catch (err) {
      setListError(errorText(err));
    } finally {
      setRevoking((s) => {
        const n = new Set(s);
        n.delete(inv.id);
        return n;
      });
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(origin);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the link is selectable in the field */
    }
  }

  const error = listError ?? (loadError ? errorText(loadError) : null);

  return (
    <section aria-labelledby="invite-h" className="flex flex-col gap-3">
      <h2 id="invite-h" className="m-0 text-base font-semibold">Invite a teammate</h2>
      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-start gap-4 max-lg:grid-cols-1">
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-3.5 rounded-xl border border-border bg-surface p-[18px]">
          <div>
            <label htmlFor="invite-email" className="mb-1 block text-[13px] font-medium">Email</label>
            <input
              id="invite-email"
              type="email"
              autoComplete="off"
              className="field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              aria-describedby="invite-hint"
              aria-invalid={formError ? true : undefined}
            />
          </div>
          <fieldset className="m-0 border-none p-0">
            <legend className="mb-1.5 text-[13px] font-medium">Roles</legend>
            <div className="flex flex-col gap-1.5">
              {KNOWN_ROLES.map((r) => (
                <label
                  key={r}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 ${
                    roles.includes(r) ? "border-accent bg-accent-soft" : "border-border"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={roles.includes(r)}
                    onChange={(e) => toggle(r, e.target.checked)}
                    className="mt-0.5 accent-[var(--accent)]"
                  />
                  <span className="flex flex-col">
                    <span className="text-[13px] font-semibold">{r}</span>
                    <span className="text-xs text-muted">{ROLE_DESCRIPTIONS[r]}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {formError && <ErrorNote>{formError}</ErrorNote>}
          <div className="flex items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting && <LoaderCircle size={14} className="spin" />}
              {submitting ? "Inviting…" : "Invite"}
            </button>
          </div>
          <p id="invite-hint" className="m-0 text-xs leading-normal text-muted">
            They sign in with Google using this email; no email is sent — share the app link with them.
          </p>
          <div className="flex items-center gap-2">
            <label htmlFor="app-link" className="sr-only">App link</label>
            <input id="app-link" readOnly value={origin} onFocus={(e) => e.currentTarget.select()} className="field min-w-0 flex-1 font-mono text-xs" />
            <button type="button" className="btn" onClick={() => void copy()} disabled={!origin}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </form>

        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-[13px] font-semibold">Pending invitations</h3>
          {error && (
            <ErrorNote>
              <span className="flex flex-wrap items-center justify-between gap-3">
                <span>{error}</span>
                <button type="button" className="btn btn-sm" disabled={validating} onClick={() => { setListError(null); void refresh(); }}>
                  {validating && <LoaderCircle size={14} className="spin" />}
                  Retry
                </button>
              </span>
            </ErrorNote>
          )}
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table aria-busy={loading} className="w-full min-w-[420px] border-collapse text-[13px]">
              <caption className="sr-only">Invitations</caption>
              <thead>
                <tr>
                  <th scope="col" className="th">Email</th>
                  <th scope="col" className="th">Roles</th>
                  <th scope="col" className="th">Invited</th>
                  <th scope="col" className="th"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {loading && !loadError && <TableSkeletonRows rows={3} cols={4} />}
                {invites?.length === 0 && (
                  <tr><td colSpan={4} className="td text-muted">No invitations yet.</td></tr>
                )}
                {invites?.map((inv) => (
                  <tr key={inv.id} className="align-top">
                    <td className="td [overflow-wrap:anywhere]">{inv.email}</td>
                    <td className="td">{inv.roles.join(", ")}</td>
                    <td className="td whitespace-nowrap text-muted">{new Date(inv.created_at).toLocaleDateString()}</td>
                    <td className="td text-right">
                      {inv.accepted_at ? (
                        <span className="badge" title={`Joined ${new Date(inv.accepted_at).toLocaleString()}`}>Joined</span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm btn-quiet btn-quiet-danger"
                          disabled={revoking.has(inv.id)}
                          onClick={() => void revoke(inv)}
                          aria-label={`Revoke invitation for ${inv.email}`}
                        >
                          {revoking.has(inv.id) && <LoaderCircle size={14} className="spin" />}
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div role="status" className="sr-only">{note}</div>
    </section>
  );
}
