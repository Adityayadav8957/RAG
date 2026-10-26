"use client";

import { useRouter } from "next/navigation";
import { signOutRequest } from "@/lib/auth";
import { useNotice } from "../FreeTierNotice";
import { LogOut, Zap } from "../icons";
import { Skel } from "../skeletons";
import { useUser } from "../UserProvider";
import { ThemeSwitch } from "./ThemeSwitch";

export function AccountSection() {
  const { user } = useUser();
  const router = useRouter();
  const { open: showNotice } = useNotice();
  async function signOut() {
    await signOutRequest();
    router.replace("/login");
    router.refresh();
  }
  const rows: [string, string][] = user
    ? [["Name", user.name || "—"], ["Email", user.email], ["Roles", user.roles.join(", ") || "none"]]
    : [];
  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-[18px] py-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">Theme</span>
          <span className="text-[13px] text-muted">Applies on this device</span>
        </div>
        <ThemeSwitch />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-[18px] py-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">Performance note</span>
          <span className="text-[13px] text-muted">Why this demo can be slow: it runs on free tiers.</span>
        </div>
        <button type="button" className="btn" onClick={showNotice}>
          <Zap size={16} />
          Show note
        </button>
      </div>
      {!user && (
        <div role="status" aria-busy="true" className="flex flex-col gap-3 border-b border-border px-[18px] py-3.5">
          <span className="sr-only">Loading account</span>
          <Skel className="h-[14px] w-full" />
          <Skel className="h-[14px] w-full" />
          <Skel className="h-[14px] w-full" />
        </div>
      )}
      <dl className="m-0">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 border-b border-border px-[18px] py-3.5 text-[13px]">
            <dt className="text-muted">{k}</dt>
            <dd className="m-0 text-right [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex items-center justify-between gap-4 px-[18px] py-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">Sign out</span>
          <span className="text-[13px] text-muted">Ends your session on this device.</span>
        </div>
        <button type="button" className="btn" onClick={() => void signOut()}>
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </div>
  );
}
