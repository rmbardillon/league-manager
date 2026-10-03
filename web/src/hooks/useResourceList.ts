/**
 * A cascading, cache-backed list-loading hook for the selector/read views.
 *
 * A thin wrapper over {@link useAsync} that:
 *   - normalizes the `data | null` / `error` shape into a ready-to-render
 *     `{ items, loading, error, reload }` (items is always an array);
 *   - skips the loader when `key` is `null` — the cascading gate: a child list
 *     keys off its selected parent id, so clearing a parent resets the child to
 *     an empty, idle list (Req 3.3, 3.4);
 *   - serves repeat reads of the same key from {@link getCached} so re-opening a
 *     view or re-selecting a previous parent is instant (no refetch);
 *   - exposes `reload()` which invalidates the cache for the current key and
 *     refetches, used both for the error-state Retry (Req 3.8) and to refresh a
 *     list after a mutation.
 */
import { useCallback, useMemo, useState } from 'react';

import { getCached, invalidate } from '../api/resourceCache.js';
import { useAsync } from './useAsync.js';

export interface ResourceList<T> {
  items: T[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * @param loader Produces the list for the current `key`; must honor the passed
 *               {@link AbortSignal}. Invoked only on a cache miss.
 * @param key    The request path identifying this resource (e.g. `/leagues` or
 *               `/seasons/{id}/teams`), also used as the cache key. When `null`
 *               the loader is skipped and the list is idle-empty.
 */
export function useResourceList<T>(
  loader: (signal: AbortSignal) => Promise<T[]>,
  key: string | null,
): ResourceList<T> {
  const [nonce, setNonce] = useState(0);

  // The useAsync key folds in the reload nonce so a reload re-runs the loader,
  // while the cache key stays the stable request path.
  const asyncKey = key === null ? null : `${key}#${nonce}`;

  const cachedLoader = useCallback(
    (signal: AbortSignal) => {
      // key is non-null whenever useAsync invokes this (asyncKey is null otherwise).
      return getCached<T[]>(key as string, loader, signal);
    },
    [key, loader],
  );

  const { data, loading, error } = useAsync<T[]>(cachedLoader, asyncKey);

  const reload = useCallback(() => {
    if (key !== null) {
      invalidate(key);
    }
    setNonce((n) => n + 1);
  }, [key]);

  const items = useMemo(() => data ?? [], [data]);

  return { items, loading, error, reload };
}
