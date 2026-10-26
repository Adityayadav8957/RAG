import { useEffect, useState } from "react";

function remaining(expiresAt: string): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

/** Seconds left until `expiresAt`, ticking once a second. */
export function useRemaining(expiresAt: string): number {
  const [secs, setSecs] = useState(() => remaining(expiresAt));
  useEffect(() => {
    setSecs(remaining(expiresAt));
    const t = setInterval(() => setSecs(remaining(expiresAt)), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return secs;
}

export function formatRemaining(secs: number): string {
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}
