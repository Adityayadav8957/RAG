"use client";

import { useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { AclFields, type AclState } from "./AclFields";
import { LoaderCircle } from "./icons";
import { Modal } from "./Modal";

const MAX_BYTES = 10 * 1024 * 1024;
const EXT = [".pdf", ".docx", ".txt", ".md"];

export function UploadDialog({ onClose, onUploaded }: { onClose: () => void; onUploaded: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [acl, setAcl] = useState<AclState>({ visibility: "all", roles: [], emails: "" });
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const file = fileRef.current?.files?.[0];
    if (!file) return setError("Choose a file to upload.");
    if (!EXT.some((x) => file.name.toLowerCase().endsWith(x))) return setError("Unsupported file type. Use PDF, DOCX, TXT or MD.");
    if (file.size > MAX_BYTES) return setError("File is larger than 10 MB.");
    const form = new FormData();
    form.set("file", file);
    form.set("visibility", acl.visibility);
    form.set("allowed_roles", acl.visibility === "restricted" ? acl.roles.join(",") : "");
    form.set("allowed_user_emails", acl.visibility === "restricted" ? acl.emails : "");
    setUploading(true);
    try {
      await api.uploadDocument(form, setProgress);
      onUploaded();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Network error. Please try again.");
      setUploading(false);
    }
  }

  return (
    <Modal titleId="upload-title" onClose={onClose} dismissible={!uploading}>
      <form onSubmit={(e) => void upload(e)} aria-label="Upload document" className="flex flex-col gap-4 px-[22px] py-5">
        <h2 id="upload-title" className="m-0 text-lg font-semibold tracking-[-0.01em]">
          Upload a document
        </h2>
        <div>
          <label htmlFor="file" className="mb-1.5 block text-[13px] font-semibold">
            File (PDF, DOCX, TXT or MD, up to 10 MB)
          </label>
          <input id="file" ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" className="field h-auto py-2" />
        </div>
        <AclFields value={acl} onChange={setAcl} idPrefix="upload" />
        {uploading && (
          <div role="status" className="flex flex-col gap-1.5 text-[13px] text-muted">
            <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
              <div
                role="progressbar"
                aria-label="Upload progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
                className="h-full rounded-full bg-accent transition-[width] duration-150"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <span>{progress >= 1 ? "Upload complete. Processing…" : `Uploading ${Math.round(progress * 100)}%`}</span>
          </div>
        )}
        {error && (
          <p role="alert" className="m-0 rounded-lg bg-err-soft px-3 py-2.5 text-[13px] text-err">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={uploading}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={uploading}>
            {uploading && <LoaderCircle size={14} className="spin" />}
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
