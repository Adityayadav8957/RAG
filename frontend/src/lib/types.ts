export type Role = "employee" | "manager" | "hr" | "admin";
export const KNOWN_ROLES: Role[] = ["employee", "manager", "hr", "admin"];

export interface User {
  id: string;
  email: string;
  name: string;
  roles: string[];
}

export interface Conversation {
  id: string;
  title: string;
  updated_at: string;
}

export interface Citation {
  n: number;
  document_id: string;
  title: string;
  chunk_id: string;
  excerpt: string;
}

export type TraceStatus = "running" | "done" | "blocked" | "skipped" | "waiting" | "error";

/** One step of the agent pipeline. `detail` is stage-specific and every field in it is optional. */
export interface TraceEvent {
  seq: number;
  stage: string;
  title: string;
  status: TraceStatus;
  /** Milliseconds since the request started. */
  at_ms: number;
  /** Duration of this step, when the backend measured it. */
  ms: number | null;
  detail: Record<string, unknown>;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations: Citation[];
  created_at: string;
  /** Raw (unvalidated) stored trace for assistant messages; run it through parseTrace. */
  trace?: unknown;
  cached?: boolean;
}

export interface PendingAction {
  id: string;
  tool: string;
  summary: string;
  arguments: Record<string, unknown>;
  expires_at: string;
}

export type DocStatus = "processing" | "ready" | "failed";
export type Visibility = "all" | "restricted";

export interface DocumentItem {
  id: string;
  title: string;
  filename: string;
  status: DocStatus;
  error: string | null;
  visibility: Visibility;
  allowed_roles: string[];
  chunk_count: number;
  created_at: string;
  owner_id: string;
}

export interface JiraStatus {
  connected: boolean;
  site_url: string | null;
  configured: boolean;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  roles: string[];
  /** Only present if the API returns it; the Users table hides the column otherwise. */
  last_login_at?: string | null;
}

export interface Invitation {
  id: string;
  email: string;
  roles: string[];
  created_at: string;
  accepted_at: string | null;
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  employee: "Chat and read the company documents they are allowed to see.",
  manager: "Everything an employee can do, plus upload and share documents.",
  hr: "Everything an employee can do, plus upload and share documents.",
  admin: "Everything above, plus manage users and see the audit log.",
};

export interface AuditEntry {
  id: number;
  ts: string;
  actor_id: string | null;
  event: string;
  resource: string | null;
  request_id: string | null;
  details: Record<string, unknown> | null;
}

export type ChatEvent =
  | { type: "status"; step: string }
  | { type: "token"; text: string }
  | { type: "approval_required"; action: PendingAction }
  | { type: "final"; message_id: string; text: string; citations: Citation[]; cached?: boolean }
  | { type: "trace"; seq: number; stage: string; title: string; status: TraceStatus; at_ms: number; ms: number | null; detail: Record<string, unknown> }
  | { type: "error"; message: string };

export function canUpload(user: User | null): boolean {
  return !!user && user.roles.some((r) => r === "hr" || r === "manager" || r === "admin");
}
export function isAdmin(user: User | null): boolean {
  return !!user && user.roles.includes("admin");
}
