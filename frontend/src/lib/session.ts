export const SESSION_COOKIE = "session";

export function backendUrl(): string {
  return process.env.BACKEND_URL || "http://localhost:8000";
}

export function cookieSecure(): boolean {
  return process.env.SESSION_COOKIE_SECURE !== "false";
}

export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: cookieSecure(),
    path: "/",
    maxAge,
  };
}
