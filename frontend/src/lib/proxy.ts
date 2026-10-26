export const ALLOWED_METHODS = ["GET", "POST", "PUT", "DELETE"] as const;

export function isAllowedMethod(method: string): boolean {
  return (ALLOWED_METHODS as readonly string[]).includes(method.toUpperCase());
}

/**
 * Build the headers sent to the backend. Only a safe allow-list is forwarded;
 * cookies and hop-by-hop headers are never passed through.
 */
export function buildBackendHeaders(incoming: Headers, token: string): Headers {
  const out = new Headers();
  const contentType = incoming.get("content-type");
  if (contentType) out.set("content-type", contentType);
  const accept = incoming.get("accept");
  if (accept) out.set("accept", accept);
  out.set("authorization", `Bearer ${token}`);
  return out;
}

/** Returns null when the path contains traversal or empty segments. */
export function buildBackendUrl(base: string, segments: string[], search: string): string | null {
  if (segments.length === 0) return null;
  for (const s of segments) {
    if (s === "" || s === "." || s === ".." || s.includes("/") || s.includes("\\")) return null;
  }
  const path = segments.map((s) => encodeURIComponent(s)).join("/");
  return `${base.replace(/\/+$/, "")}/v1/${path}${search}`;
}

const DROP_RESPONSE_HEADERS = new Set([
  "set-cookie",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
  "content-encoding",
]);

export function filterResponseHeaders(upstream: Headers): Headers {
  const out = new Headers();
  upstream.forEach((value, key) => {
    if (!DROP_RESPONSE_HEADERS.has(key.toLowerCase())) out.set(key, value);
  });
  return out;
}
