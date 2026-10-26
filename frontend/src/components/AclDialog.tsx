"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { DocumentItem } from "@/lib/types";
import { AclFields, type AclState } from "./AclFields";
import { LoaderCircle } from "./icons";
import { Modal } from "./Modal";

export function AclDialog({ doc, onClose, onSaved }: { doc: DocumentItem; onClose: () => void; onSaved: () => void }) {
  const [acl, setAcl] = useState<AclState>({ visibility: doc.visibility, roles: doc.allowed_roles, emails: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.updateAcl(doc.id, {
        visibility: acl.visibility,
        allowed_roles: acl.visibility === "restricted" ? acl.roles : [],
        allowed_user_emails:
          acl.visibility === "restricted" ? acl.emails.split(",").map((s) => s.trim()).filter(Boolean) : [],
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Network error. Please try again.");
      setSaving(false);
    }
  }

  return (
    <Modal titleId="acl-title" onClose={onClose} dismissible={!saving}>
      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-4 px-[22px] py-5">
        <div className="flex flex-col gap-1">
          <h2 id="acl-title" className="m-0 text-lg font-semibold tracking-[-0.01em] [overflow-wrap:anywhere]">
            Access for {doc.title}
          </h2>
          <p className="m-0 text-[13px] text-muted">Listing user emails replaces the existing per-user grants. Leave empty to grant none.</p>
        </div>
        <AclFields value={acl} onChange={setAcl} idPrefix="acl" />
        {error && (
          <p role="alert" className="m-0 rounded-lg bg-err-soft px-3 py-2.5 text-[13px] text-err">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving && <LoaderCircle size={14} className="spin" />}
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
