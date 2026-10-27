"use client";

import Script from "next/script";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";
import { LoaderCircle, ShieldCheck } from "@/components/icons";

interface CredentialResponse {
  credential: string;
}
interface GoogleId {
  initialize(cfg: { client_id: string; callback: (r: CredentialResponse) => void; ux_mode?: "popup" }): void;
  renderButton(el: HTMLElement, opts: Record<string, string | number>): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

export default function LoginPage() {
  const router = useRouter();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState(false);


  const onCredential = useCallback(
    async (r: CredentialResponse) => {
      setBusy(true);
      setError(null);
      setRejected(false);
      try {
        const res = await fetch("/api/auth/google", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ credential: r.credential }),
        });
        if (!res.ok) {
          let detail = "";
          try {
            const j: unknown = await res.json();
            if (typeof j === "object" && j !== null && typeof (j as { detail?: unknown }).detail === "string") {
              detail = (j as { detail: string }).detail;
            }
          } catch {
            /* ignore */
          }
          if (res.status === 403) {
            setError(detail || "This Google account is not allowed to use this application.");
            setRejected(true);
          } else if (res.status === 502) {
            setError("The service is temporarily unavailable. Please try again shortly.");
          } else {
            setError(detail || "Sign-in failed. Please try again.");
          }
          setBusy(false);
          return;
        }
        router.replace("/");
      } catch {
        setError("Network error. Check your connection and try again.");
        setBusy(false);
      }
    },
    [router],
  );

  const initGoogle = useCallback(() => {
    const id = window.google?.accounts.id;
    if (!id || !buttonRef.current || !CLIENT_ID) return;
    id.initialize({ client_id: CLIENT_ID, callback: (r) => void onCredential(r), ux_mode: "popup" });
    id.renderButton(buttonRef.current, { theme: "outline", size: "large", text: "continue_with", shape: "rectangular", width: 280 });
  }, [onCredential]);

  return (
    <main className="grid min-h-dvh place-items-center bg-bg p-6 text-ink">
      {CLIENT_ID && <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onReady={initGoogle} />}
      <div className="flex w-full max-w-[380px] flex-col items-center gap-3.5 text-center">
        <BrandMark size={72} />
        <h1 className="m-0 text-[22px] font-semibold tracking-[-0.01em]">Sign in or create your workspace with Google</h1>
        <p className="m-0 text-sm leading-[1.55] text-muted">
          Meet Dobby. Company accounts join their company workspace; personal accounts get a private one. If you were
          invited, just sign in with the email you were invited at. Your conversations stay private to you.
        </p>

        <div className="mt-1.5 flex min-h-11 justify-center">
          {CLIENT_ID ? (
            <div ref={buttonRef} aria-label="Sign in with Google" />
          ) : (
            <div role="alert" className="rounded-lg bg-warn-soft px-3 py-2.5 text-left text-[13px] text-warn">
              Sign-in is not configured. Set <code className="font-mono">NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> in the environment and rebuild.
            </div>
          )}
        </div>

        <div aria-live="polite" className="min-h-5 w-full text-[13px]">
          {busy && (
            <p className="m-0 flex items-center justify-center gap-2 text-muted">
              <LoaderCircle size={14} className="spin" />
              Signing in…
            </p>
          )}
          {error && (
            <div role="alert" className="flex flex-col gap-1.5 rounded-lg bg-err-soft px-3 py-2.5 text-left text-err">
              <p className="m-0 font-semibold [overflow-wrap:anywhere]">{error}</p>
              {rejected && (
                <p className="m-0 text-xs font-normal text-muted">
                  Ask an administrator to invite the email you signed in with, or sign in with a different Google account.
                </p>
              )}
            </div>
          )}
        </div>
        <p className="m-0 flex items-center gap-1.5 text-xs text-faint">
          <ShieldCheck size={14} />
          Actions that change data always ask first
        </p>
      </div>
    </main>
  );
}
