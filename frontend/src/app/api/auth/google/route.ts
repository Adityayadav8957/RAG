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

  let upstream: Response;
  try {
    upstream = await fetch(`${backendUrl()}/v1/auth/google`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credential }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ detail: "Backend unavailable" }, { status: 502 });
  }

  if (!upstream.ok) {
    let detail: unknown = "Sign-in failed";
    try {
      const j: unknown = await upstream.json();
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
