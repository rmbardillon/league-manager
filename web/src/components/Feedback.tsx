/**
 * Small accessibility-minded feedback components shared across views, themed
 * with Mantine so they match the rest of the UI (Req 10.1).
 *
 *   - {@link LoadingIndicator} announces a busy state via `role="status"`.
 *   - {@link ErrorMessage} announces a failure via `role="alert"` so screen
 *     readers are notified immediately.
 *   - {@link EmptyMessage} renders an informational empty-state note (Req 10.2)
 *     as ordinary status text, not an error.
 */
import type { ReactNode } from 'react';
import { Alert, Group, Loader, Text } from '@mantine/core';

/** A polite "loading" status region. */
export function LoadingIndicator({ label = 'Loading…' }: { label?: string }): JSX.Element {
  return (
    <Group role="status" aria-live="polite" gap="xs" my="sm">
      <Loader size="sm" />
      <Text size="sm" c="dimmed">
        {label}
      </Text>
    </Group>
  );
}

/** An assertive error region (screen readers announce it immediately). */
export function ErrorMessage({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Alert role="alert" color="nba-red" variant="light" my="sm" title="Something went wrong">
      {children}
    </Alert>
  );
}

/** A neutral, informational empty-state message (not an error). */
export function EmptyMessage({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Text role="status" c="dimmed" my="sm">
      {children}
    </Text>
  );
}
