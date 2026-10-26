"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { fetchCache, type Snapshot } from "./fetchCache";

export interface CachedFetch<T> {
  data: T | undefined;
  error: unknown;
  /** True only while there is nothing to show yet (first load). */
  loading: boolean;
  /** True while a request is in flight, including background revalidation of cached data. */
  validating: boolean;
  /** Force a refetch now. */
  refresh: () => Promise<void>;
  /** Overwrite the cached value (optimistic updates). */
  mutate: (value: T | ((prev: T | undefined) => T | undefined)) => void;
}

const SERVER: Snapshot<never> = { data: undefined, error: undefined, validating: false, at: 0 };

/**
 * Stale-while-revalidate GET hook. Cached data is returned instantly and refreshed when older than `staleMs`
 * (default 15 s). `refreshInterval` (ms, or false) polls while mounted and the tab is visible.
 */
export function useCachedFetch<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  opts: { staleMs?: number; refreshInterval?: number | false } = {},
): CachedFetch<T> {
  const { staleMs = 15_000, refreshInterval = false } = opts;
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const snap = useSyncExternalStore(
    useCallback((fn) => (key ? fetchCache.subscribe(key, fn) : () => undefined), [key]),
    () => (key ? fetchCache.get<T>(key) : (SERVER as Snapshot<T>)),
    () => SERVER as Snapshot<T>,
  );

  useEffect(() => {
    if (key) void fetchCache.revalidate(key, () => fetcherRef.current(), staleMs);
  }, [key, staleMs]);

  useEffect(() => {
    if (!key || !refreshInterval) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void fetchCache.revalidate(key, () => fetcherRef.current());
    }, refreshInterval);
    return () => clearInterval(t);
  }, [key, refreshInterval]);

  const refresh = useCallback(async () => {
    if (key) await fetchCache.revalidate(key, () => fetcherRef.current());
  }, [key]);
  const mutate = useCallback(
    (value: T | ((prev: T | undefined) => T | undefined)) => {
      if (key) fetchCache.set<T>(key, value);
    },
    [key],
  );

  return {
    data: snap.data,
    error: snap.error,
    loading: snap.data === undefined && snap.error === undefined,
    validating: snap.validating,
    refresh,
    mutate,
  };
}
