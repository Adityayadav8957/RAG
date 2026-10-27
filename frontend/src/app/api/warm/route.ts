import { NextResponse } from "next/server";
import { backendUrl } from "@/lib/session";

export const dynamic = "force-dynamic";

// Wakes the sleeping backend (Render free tier) and resolves once it answers, so the login page can show progress.
export async function GET() {
  try {
    const r = await fetch(`${backendUrl()}/readyz`, { cache: "no-store", signal: AbortSignal.timeout(85_000) });
    console.log(`[warm] ${backendUrl()}/readyz -> ${r.status}`);
    return NextResponse.json({ ok: r.ok });
  } catch (e) {
    console.error("[warm] failed", e);
    return NextResponse.json({ ok: false });
  }
}
