import { fetchCache } from "./fetchCache";

/** Clears the httpOnly session cookie via the BFF. Always resolves so the caller can navigate away. */
export async function signOutRequest(): Promise<void> {
  fetchCache.clear();
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    /* ignore: the middleware will still bounce an invalid session */
  }
}
