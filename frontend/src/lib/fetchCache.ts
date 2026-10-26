/**
 * A tiny stale-while-revalidate store for GET requests. Entries live in memory for the lifetime of the page,
 * so navigating back to a screen shows the last data immediately while a fresh copy loads in the background.
 * Concurrent requests for the same key share one in-flight promise.
 */
export interface Snapshot<T> {
  data: T | undefined;
  error: unknown;
  /** True while a request for this key is in flight (including background revalidation). */
  validating: boolean;
  /** Timestamp (ms) of the last successful fetch, 0 if none. */
  at: number;
}

const EMPTY: Snapshot<never> = { data: undefined, error: undefined, validating: false, at: 0 };

export interface FetchCache {
  get<T>(key: string): Snapshot<T>;
  subscribe(key: string, fn: () => void): () => void;
  /** Fetch unless fresh data (younger than staleMs) is cached; dedupes concurrent calls. */
  revalidate<T>(key: string, fetcher: () => Promise<T>, staleMs?: number): Promise<void>;
  /** Replace cached data (optimistic update or post-mutation write). Accepts an updater. */
  set<T>(key: string, value: T | ((prev: T | undefined) => T | undefined)): void;
  clear(): void;
}

export function createFetchCache(now: () => number = Date.now): FetchCache {
  const snaps = new Map<string, Snapshot<unknown>>();
  const inflight = new Map<string, Promise<void>>();
  const subs = new Map<string, Set<() => void>>();

  const get = <T,>(key: string) => (snaps.get(key) ?? EMPTY) as Snapshot<T>;
  const put = (key: string, patch: Partial<Snapshot<unknown>>) => {
    snaps.set(key, { ...get<unknown>(key), ...patch });
    subs.get(key)?.forEach((fn) => fn());
  };

  return {
    get,
    subscribe(key, fn) {
      let set = subs.get(key);
      if (!set) subs.set(key, (set = new Set()));
      set.add(fn);
      return () => {
        set.delete(fn);
      };
    },
    revalidate<T>(key: string, fetcher: () => Promise<T>, staleMs = 0) {
      const existing = inflight.get(key);
      if (existing) return existing;
      const cur = get<T>(key);
      if (cur.data !== undefined && staleMs > 0 && now() - cur.at < staleMs) return Promise.resolve();
      put(key, { validating: true });
      const p = fetcher().then(
        (data) => put(key, { data, error: undefined, validating: false, at: now() }),
        (error: unknown) => put(key, { error, validating: false }),
      ).finally(() => {
        inflight.delete(key);
      });
      inflight.set(key, p);
      return p;
    },
    set<T>(key: string, value: T | ((prev: T | undefined) => T | undefined)) {
      const prev = get<T>(key).data;
      const next = typeof value === "function" ? (value as (p: T | undefined) => T | undefined)(prev) : value;
      put(key, { data: next, at: now() });
    },
    clear() {
      snaps.clear();
      inflight.clear();
      subs.forEach((s) => s.forEach((fn) => fn()));
    },
  };
}

export const fetchCache = createFetchCache();
