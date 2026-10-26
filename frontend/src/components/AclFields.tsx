"use client";

import type { Visibility } from "@/lib/types";

export interface AclState {
  visibility: Visibility;
  roles: string[];
  emails: string;
}

const ROLE_OPTIONS = ["employee", "manager", "hr", "admin"];

export function AclFields({ value, onChange, idPrefix }: { value: AclState; onChange: (v: AclState) => void; idPrefix: string }) {
  const restricted = value.visibility === "restricted";
  return (
    <div className="flex flex-col gap-3.5">
      <fieldset className="m-0 border-none p-0">
        <legend className="mb-1.5 text-[13px] font-semibold">Who can see this document</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
          {(["all", "restricted"] as const).map((v) => (
            <label key={v} className="flex items-center gap-2">
              <input
                type="radio"
                name={`${idPrefix}-visibility`}
                checked={value.visibility === v}
                onChange={() => onChange({ ...value, visibility: v })}
                className="accent-[var(--accent)]"
              />
              {v === "all" ? "Everyone in the company" : "Restricted"}
            </label>
          ))}
        </div>
      </fieldset>
      {restricted && (
        <>
          <fieldset className="m-0 border-none p-0">
            <legend className="mb-1.5 text-[13px] font-semibold">Allowed roles</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
              {ROLE_OPTIONS.map((r) => (
                <label key={r} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={value.roles.includes(r)}
                    onChange={(e) =>
                      onChange({ ...value, roles: e.target.checked ? [...value.roles, r] : value.roles.filter((x) => x !== r) })
                    }
                    className="accent-[var(--accent)]"
                  />
                  {r}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor={`${idPrefix}-emails`} className="mb-1.5 block text-[13px] font-semibold">
              Additional user emails (comma-separated)
            </label>
            <input
              id={`${idPrefix}-emails`}
              type="text"
              className="field"
              value={value.emails}
              onChange={(e) => onChange({ ...value, emails: e.target.value })}
              placeholder="alex@company.com, sam@company.com"
            />
          </div>
        </>
      )}
    </div>
  );
}
