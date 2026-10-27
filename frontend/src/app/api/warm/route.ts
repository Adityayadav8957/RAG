import { NextResponse } from "next/server";
import { backendUrl } from "@/lib/session";

export const dynamic = "force-dynamic";

// Wakes the sleeping backend (Render free tier). Fire-and-forget: the client doesn't wait for it.
export async function GET() {
  void fetch(`${backendUrl()}/readyz`, { cache: "no-store", signal: AbortSignal.timeout(90_000) }).catch(() => {});
  return NextResponse.json({ ok: true });
}
