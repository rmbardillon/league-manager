/**
 * A tiny, per-page-load in-memory cache for API list reads.
 *
 * Keyed by request path, it wraps a loader so that re-opening a view or
 * re-selecting a previously chosen parent is instant and does not refetch
 * (the stored promise is returned as-is). After a successful mutation the
 * relevant key is invalidated so the next read reflects the change
 * (per-key invalidation — Req 4.2, 5.3, etc.).
 *
 * The cache lives only for the current page load; a refresh clears it and the
 * next read fetches from the API, which remains the source of truth
 * (Req 5.2, 6.2). It stores the loader's *promise* rather than its resolved
 * value so concurrent reads for the same key share one in-flight request, and
 * a rejected load is not cached (the entry is dropped so a retry refetches).
 */

const store = new Map<string, Promise<unknown>>();

/**
 * Resolve a cached value for `key`, or run `loader` and cache its promise.
 *
 * @param key    The request path identifying this resource (e.g. `/leagues`).
 * @param loader Produces the value; must honor the passed {@link AbortSignal}.
 *               It is only invoked on a cache miss.
 */
export function getCached<T>(
  key: string,
  loader: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  const existing = store.get(key);
  if (existing !== undefined) {
    return existing as Promise<T>;
  }

  const pending = loader(signal).catch((error: unknown) => {
    // Never cache a failed load: drop the entry so a retry refetches.
    if (store.get(key) === pending) {
      store.delete(key);
    }
    throw error;
  });
  store.set(key, pending);
  return pending;
}

/** Drop the cached entry for a single key (per-key invalidation after a mutation). */
export function invalidate(key: string): void {
  store.delete(key);
}

/** Drop every cached entry (e.g. on sign-out). */
export function invalidateAll(): void {
  store.clear();
}
