/**
 * A tiny data-loading hook for the read views.
 *
 * Runs an async loader whenever its dependency key changes, tracking loading,
 * data, and error state, and aborting an in-flight request on cleanup so a
 * stale response never overwrites a newer one. The loader receives an
 * {@link AbortSignal} it should forward to the API call.
 */
import { useEffect, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * @param loader Produces the value; must honor the passed AbortSignal.
 * @param key    Re-runs the loader when this changes. When falsy, the loader is
 *               skipped and the state is reset to idle-empty.
 */
export function useAsync<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  key: string | null,
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: Boolean(key),
    error: null,
  });

  useEffect(() => {
    if (!key) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setState({ data: null, loading: true, error: null });
    loader(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({ data, loading: false, error: null });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const message =
          error instanceof Error ? error.message : 'Something went wrong loading data.';
        setState({ data: null, loading: false, error: message });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
