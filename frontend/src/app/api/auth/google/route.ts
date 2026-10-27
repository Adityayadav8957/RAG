import { NextResponse } from "next/server";
import { backendUrl, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const dynamic = "force-dynamic";

interface SessionResponse {
  access_token: string;
  expires_in: number;
  user: unknown;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "Invalid JSON" }, { status: 400 });
  }
  const credential =
    typeof body === "object" && body !== null && "credential" in body
      ? (body as { credential: unknown }).credential
      : undefined;
  if (typeof credential !== "string" || credential.length === 0) {
    return NextResponse.json({ detail: "Missing credential" }, { status: 400 });
  }

  // Render's free tier sleeps; the proxy answers 502/503/504 (HTML) while the API wakes (~30-60s).
  const WAKING = new Set([502, 503, 504]);
  let upstream: Response | undefined;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      upstream = await fetch(`${backendUrl()}/v1/auth/google`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential }),
        cache: "no-store",
      });
      console.log(`[auth/google] attempt ${attempt + 1}: upstream ${upstream.status}`);
      if (!WAKING.has(upstream.status)) break;
    } catch (e) {
      console.error(`[auth/google] attempt ${attempt + 1}: fetch to ${backendUrl()} failed`, e);
      upstream = undefined;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!upstream || WAKING.has(upstream.status)) {
    console.error(`[auth/google] backend still unavailable (status ${upstream?.status ?? "none"})`);
    return NextResponse.json(
      { detail: "Backend is waking up, please try again in a moment" },
      { status: 503 },
    );
  }

  if (!upstream.ok) {
    let detail: unknown = "Sign-in failed";
    const raw = await upstream.text();
    console.error(`[auth/google] upstream ${upstream.status}: ${raw.slice(0, 300)}`);
    try {
      const j: unknown = JSON.parse(raw);
      if (typeof j === "object" && j !== null && "detail" in j) detail = (j as { detail: unknown }).detail;
    } catch {
      /* keep default */
    }
    return NextResponse.json({ detail }, { status: upstream.status });
  }

  const session = (await upstream.json()) as SessionResponse;
  const res = NextResponse.json({ user: session.user });
  res.cookies.set(SESSION_COOKIE, session.access_token, sessionCookieOptions(session.expires_in));
  return res;
}
