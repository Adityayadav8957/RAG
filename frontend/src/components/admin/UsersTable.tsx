"use client";

import { useState } from "react";
import { api, errorText } from "@/lib/api";
import { fetchUsers, USERS_KEY } from "@/lib/adminQueries";
import { KNOWN_ROLES, type AdminUser } from "@/lib/types";
import { useCachedFetch } from "@/lib/useCachedFetch";
import { LoaderCircle } from "../icons";
import { ErrorNote } from "../PageHeader";
import { TableSkeletonRows } from "../skeletons";

export function UsersTable() {
  const { data: users, error: loadError, loading, validating, refresh, mutate } = useCachedFetch(USERS_KEY, fetchUsers);
  const [actionError, setActionError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  /** User ids with a request in flight, so each row shows its own pending state. */
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const error = actionError ?? (loadError ? errorText(loadError) : null);
  const showLastLogin = users?.some((u) => u.last_login_at !== undefined) ?? false;
  const cols = showLastLogin ? 4 : 3;

  const track = async (id: string, fn: () => Promise<void>) => {
    setBusy((b) => new Set(b).add(id));
    try {
      await fn();
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(id);
        return n;
      });
    }
  };

  function toggleRole(u: AdminUser, role: string, on: boolean) {
    const previous = u.roles;
    const roles = on ? [...previous, role] : previous.filter((r) => r !== role);
    setActionError(null);
    // Optimistic: the checkbox flips immediately and rolls back if the server refuses.
    mutate((us) => us?.map((x) => (x.id === u.id ? { ...x, roles } : x)));
    void track(u.id, async () => {
      try {
        const updated = await api.setRoles(u.id, roles);
        mutate((us) => us?.map((x) => (x.id === u.id ? { ...x, roles: updated.roles ?? roles } : x)));
        setNote(`Roles updated for ${u.email}`);
      } catch (e) {
        mutate((us) => us?.map((x) => (x.id === u.id ? { ...x, roles: previous } : x)));
        setActionError(errorText(e));
      }
    });
  }

  function setActive(u: AdminUser, active: boolean) {
    if (!active && !window.confirm(`Deactivate ${u.email}?`)) return;
    setActionError(null);
    void track(u.id, async () => {
      try {
        await api.setActive(u.id, active);
        setNote(`${u.email} ${active ? "activated" : "deactivated"}`);
      } catch (e) {
        setActionError(errorText(e));
      }
    });
  }

  return (
    <section aria-labelledby="users-h" className="flex flex-col gap-3">
      <h2 id="users-h" className="m-0 text-base font-semibold">Users</h2>
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
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table aria-busy={loading} className="w-full min-w-[640px] border-collapse text-[13px]">
          <caption className="sr-only">Users</caption>
          <thead>
            <tr>
              <th scope="col" className="th">User</th>
              <th scope="col" className="th">Roles</th>
              {showLastLogin && <th scope="col" className="th">Last login</th>}
              <th scope="col" className="th">Account</th>
            </tr>
          </thead>
          <tbody>
            {loading && !loadError && <TableSkeletonRows rows={4} cols={cols} />}
            {users?.map((u) => {
              const pending = busy.has(u.id);
              return (
                <tr key={u.id} className="align-top">
                  <td className="td">
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs text-faint [overflow-wrap:anywhere]">{u.email}</div>
                  </td>
                  <td className="td">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      {KNOWN_ROLES.map((r) => (
                        <label key={r} className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={u.roles.includes(r)}
                            disabled={pending}
                            onChange={(e) => toggleRole(u, r, e.target.checked)}
                            className="accent-[var(--accent)]"
                          />
                          {r}
                        </label>
                      ))}
                      {pending && <LoaderCircle size={14} className="spin text-muted" aria-label="Saving" />}
                    </div>
                  </td>
                  {showLastLogin && (
                    <td className="td whitespace-nowrap text-muted">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "Never"}</td>
                  )}
                  <td className="td">
                    <div className="flex gap-1.5">
                      <button type="button" className="btn btn-sm font-medium" disabled={pending} onClick={() => setActive(u, true)} aria-label={`Activate ${u.email}`}>
                        Activate
                      </button>
                      <button type="button" className="btn btn-sm btn-quiet btn-quiet-danger" disabled={pending} onClick={() => setActive(u, false)} aria-label={`Deactivate ${u.email}`}>
                        Deactivate
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div role="status" className="sr-only">{note}</div>
    </section>
  );
}
