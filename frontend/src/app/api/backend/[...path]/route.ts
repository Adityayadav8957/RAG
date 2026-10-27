import { NextResponse, type NextRequest } from "next/server";
import { buildBackendHeaders, buildBackendUrl, filterResponseHeaders, isAllowedMethod } from "@/lib/proxy";
import { backendUrl, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60; // Vercel: chat streams (SSE) are cut at this limit

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, ctx: Ctx): Promise<Response> {
  if (!isAllowedMethod(req.method)) {
    return NextResponse.json({ detail: "Method not allowed" }, { status: 405 });
  }
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });

  const { path } = await ctx.params;
  const url = buildBackendUrl(backendUrl(), path, req.nextUrl.search);
  if (!url) return NextResponse.json({ detail: "Bad path" }, { status: 400 });

  const hasBody = req.method !== "GET" && req.method !== "DELETE" && req.body !== null;
  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers: buildBackendHeaders(req.headers, token),
    redirect: "manual",
    cache: "no-store",
    signal: req.signal,
  };
  if (hasBody) {
    init.body = req.body;
    init.duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, init);
  } catch {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    return NextResponse.json({ detail: "Backend unavailable" }, { status: 502 });
  }

  const headers = filterResponseHeaders(upstream.headers);
  const isSse = (upstream.headers.get("content-type") ?? "").includes("text/event-stream");
  if (isSse) {
    headers.set("cache-control", "no-cache, no-transform");
    headers.set("x-accel-buffering", "no");
  }
  const noBody = upstream.status === 204 || upstream.status === 304;
  const res = new NextResponse(noBody ? null : upstream.body, { status: upstream.status, headers });
  if (upstream.status === 401) res.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
  return res;
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
export const HEAD = handle;
export const OPTIONS = handle;
