import { parseSse } from "./sse";
import type {
  AdminUser, AuditEntry, ChatEvent, Conversation, DocumentItem, Invitation, JiraStatus, Message, PendingAction, User, Visibility,
} from "./types";

const BASE = "/api/backend";

export class ApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(detail);
    this.name = "ApiError";
  }
}

function detailOf(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null && "detail" in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
      return d
        .map((x) => (typeof x === "object" && x !== null && "msg" in x ? String((x as { msg: unknown }).msg) : ""))
        .filter(Boolean)
        .join("; ") || fallback;
    }
  }
  return fallback;
}

async function toError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (res.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.replace("/login");
  }
  return new ApiError(res.status, detailOf(body, res.statusText || `Request failed (${res.status})`));
}

/** User-facing text for any error thrown by the api helpers. */
export function errorText(e: unknown): string {
  return e instanceof ApiError ? e.detail : "Network error. Please try again.";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, { ...init, cache: "no-store" });
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/** fetch() cannot report upload progress, so file uploads go through XHR when the caller wants a progress bar. */
function uploadWithProgress(form: FormData, onProgress: (fraction: number) => void): Promise<DocumentItem> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/documents`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new TypeError("Network error"));
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON body */
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body as DocumentItem);
      if (xhr.status === 401 && window.location.pathname !== "/login") window.location.replace("/login");
      reject(new ApiError(xhr.status, detailOf(body, xhr.statusText || `Request failed (${xhr.status})`)));
    };
    xhr.send(form);
  });
}

export const api = {
  me: () => request<User>("me"),
  listConversations: () => request<Conversation[]>("conversations"),
  createConversation: () => request<Conversation>("conversations", { method: "POST" }),
  deleteConversation: (id: string) => request<void>(`conversations/${id}`, { method: "DELETE" }),
  messages: (id: string) => request<Message[]>(`conversations/${id}/messages`),
  pending: (id: string) => request<PendingAction[]>(`conversations/${id}/pending`),

  listDocuments: () => request<DocumentItem[]>("documents"),
  uploadDocument: (form: FormData, onProgress?: (fraction: number) => void) =>
    onProgress ? uploadWithProgress(form, onProgress) : request<DocumentItem>("documents", { method: "POST", body: form }),
  updateAcl: (id: string, acl: { visibility: Visibility; allowed_roles: string[]; allowed_user_emails: string[] }) =>
    request<DocumentItem>(`documents/${id}/acl`, json("PUT", acl)),
  deleteDocument: (id: string) => request<void>(`documents/${id}`, { method: "DELETE" }),

  jira: () => request<JiraStatus>("integrations/jira"),
  jiraConnect: () => request<{ url: string }>("integrations/jira/connect", { method: "POST" }),
  jiraDisconnect: () => request<void>("integrations/jira", { method: "DELETE" }),

  adminUsers: () => request<AdminUser[]>("admin/users"),
  setRoles: (id: string, roles: string[]) => request<AdminUser>(`admin/users/${id}/roles`, json("PUT", { roles })),
  setActive: (id: string, active: boolean) =>
    request<unknown>(`admin/users/${id}/active?active=${active}`, { method: "PUT" }),
  invitations: () => request<Invitation[]>("admin/invitations"),
  invite: (email: string, roles: string[]) => request<Invitation>("admin/invitations", json("POST", { email, roles })),
  revokeInvitation: (id: string) => request<void>(`admin/invitations/${id}`, { method: "DELETE" }),
  audit: (p: { event?: string; limit?: number; before_id?: number }) => {
    const q = new URLSearchParams();
    if (p.event) q.set("event", p.event);
    if (p.limit) q.set("limit", String(p.limit));
    if (p.before_id !== undefined) q.set("before_id", String(p.before_id));
    return request<AuditEntry[]>(`admin/audit?${q.toString()}`);
  },
};

function isChatEvent(v: unknown): v is ChatEvent {
  return typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string";
}

/** POST and consume a text/event-stream response, invoking onEvent for each JSON event. */
export async function streamChat(
  path: string,
  body: unknown,
  onEvent: (e: ChatEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BASE}/${path}`, {
    ...json("POST", body),
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    signal,
    cache: "no-store",
  });
  if (!res.ok) throw await toError(res);
  if (!res.body) throw new ApiError(502, "Empty response from server");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let rest = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const parsed = parseSse(rest, value);
    rest = parsed.rest;
    for (const m of parsed.messages) {
      try {
        const data: unknown = JSON.parse(m.data);
        if (isChatEvent(data)) onEvent(data);
      } catch {
        /* ignore malformed event */
      }
    }
  }
  if (rest.trim()) {
    const parsed = parseSse(rest, "\n\n");
    for (const m of parsed.messages) {
      try {
        const data: unknown = JSON.parse(m.data);
        if (isChatEvent(data)) onEvent(data);
      } catch {
        /* ignore */
      }
    }
  }
}
