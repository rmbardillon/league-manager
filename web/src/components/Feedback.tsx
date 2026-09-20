/**
 * Small accessibility-minded feedback components shared across views.
 *
 *   - {@link LoadingIndicator} announces a busy state via `role="status"`.
 *   - {@link ErrorMessage} announces a failure via `role="alert"` so screen
 *     readers are notified immediately.
 *   - {@link EmptyMessage} renders an informational empty-state note (Req 10.2)
 *     as ordinary status text, not an error.
 */
import type { ReactNode } from 'react';

/** A polite "loading" status region. */
export function LoadingIndicator({ label = 'Loading…' }: { label?: string }): JSX.Element {
  return (
    <p role="status" aria-live="polite">
      {label}
    </p>
  );
}

/** An assertive error region (screen readers announce it immediately). */
export function ErrorMessage({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p role="alert" className="error">
      {children}
    </p>
  );
}

/** A neutral, informational empty-state message (not an error). */
export function EmptyMessage({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p role="status" className="empty">
      {children}
    </p>
  );
}
