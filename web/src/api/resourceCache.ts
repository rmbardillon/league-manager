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
 *
 * Important: the cached request is driven by its OWN internal AbortController,
 * NOT the per-consumer signal passed to {@link getCached}. A cached promise can
 * outlive the component render that first created it (e.g. React StrictMode
 * mounts, aborts, then re-mounts); binding the shared request to the first
 * consumer's signal would let that consumer's cleanup abort a request every
 * later consumer is awaiting, leaving them loading forever. Consumers still
 * pass their signal so they can stop *listening* to the promise, but it never
 * cancels the shared in-flight request.
 */

const store = new Map<string, Promise<unknown>>();

/**
 * Resolve a cached value for `key`, or run `loader` and cache its promise.
 *
 * @param key    The request path identifying this resource (e.g. `/leagues`).
 * @param loader Produces the value; receives an internal {@link AbortSignal}
 *               owned by the cache. Only invoked on a cache miss.
 * @param _signal The per-consumer signal. Intentionally unused for driving the
 *               shared request (see the module note); consumers abort their own
 *               listening in {@link useAsync}, not the cached request itself.
 */
export function getCached<T>(
  key: string,
  loader: (signal: AbortSignal) => Promise<T>,
  _signal: AbortSignal,
): Promise<T> {
  const existing = store.get(key);
  if (existing !== undefined) {
    return existing as Promise<T>;
  }

  // Drive the shared request with a cache-owned controller so no single
  // consumer's cleanup can cancel it out from under the others.
  const controller = new AbortController();
  const pending = loader(controller.signal).catch((error: unknown) => {
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
