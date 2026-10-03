/**
 * The generic selector base for the management UI.
 *
 * Every League/Season/Team/Player selector (and the static value selects) is a
 * thin wrapper over this component. It presents entities by human-readable
 * **name** and resolves the chosen option back to that entity's **identifier**,
 * so an operator never has to read, remember, or type a raw id (Req 3.1, 3.5,
 * 11.5).
 *
 * The id<->label mapping is factored into two pure helpers — {@link buildOptions}
 * and {@link resolveById} — so it can be exercised by a fast-check property test
 * without rendering (Correctness Property 1). The option `value` is ALWAYS the
 * entity id, which is why duplicate labels (e.g. two master Players with the
 * same name) stay unambiguous.
 *
 * Loading/empty/error presentation:
 *   - while `loading`, the control is disabled and shows a spinner (Req 3.6);
 *   - when `items` is empty (and not loading/errored), an accessible empty-state
 *     message is shown with no free-text id fallback (Req 3.7);
 *   - when `error` is set, an accessible `Alert` with a Retry button wired to
 *     `onRetry` is shown (Req 3.8).
 */
import { Alert, Button, Loader, Select, Stack, Text } from '@mantine/core';

/** A Mantine `Select` option. `value` is ALWAYS the entity id, never the label. */
export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Map a list of entities to Mantine `Select` options, using the entity id as the
 * option value and its name as the option label. Pure and side-effect free.
 *
 * Subject of Correctness Property 1 (selector name/identifier resolution round
 * trip), so it must stay importable without rendering.
 */
export function buildOptions<T>(
  items: T[],
  getId: (item: T) => string,
  getLabel: (item: T) => string,
): SelectOption[] {
  return items.map((item) => ({ value: getId(item), label: getLabel(item) }));
}

/**
 * Recover the full entity for a selected option value (an id), or `undefined`
 * when `id` is `null` or matches no entity. Pure and side-effect free.
 *
 * Subject of Correctness Property 1.
 */
export function resolveById<T>(
  items: T[],
  getId: (item: T) => string,
  id: string | null,
): T | undefined {
  if (id === null) {
    return undefined;
  }
  return items.find((item) => getId(item) === id);
}

export interface EntitySelectProps<T> {
  /** Programmatic label for the combobox (Req 11.1). */
  label: string;
  /** The entities to present as options. */
  items: T[];
  /** Extracts an entity's stable identifier (used as the option value). */
  getId: (item: T) => string;
  /** Extracts an entity's human-readable name (used as the option label). */
  getLabel: (item: T) => string;
  /** The currently selected entity id, or `null` when nothing is selected. */
  value: string | null;
  /** Called with the selected entity id (or `null` when cleared). */
  onChange: (id: string | null) => void;
  /** Whether the options are being loaded; disables the control + shows a spinner. */
  loading?: boolean;
  /** A load error message; when set, renders an alert with a Retry action. */
  error?: string | null;
  /** Invoked by the Retry button to re-attempt loading. */
  onRetry?: () => void;
  /** The empty-state message shown when there are no options to present. */
  emptyMessage?: string;
  /** Placeholder shown when no option is selected. */
  placeholder?: string;
  /** Whether a selection is required (passed through to Mantine). */
  required?: boolean;
  /** Disable the control independent of the loading state. */
  disabled?: boolean;
  /** Explicit element id for the underlying input, so callers can wire descriptions. */
  id?: string;
  /** Accessible name override; defaults to `label` when omitted. */
  'aria-label'?: string;
  /** Id of an element that labels this control. */
  'aria-labelledby'?: string;
  /** Id of an element that describes this control. */
  'aria-describedby'?: string;
}

/**
 * A labeled, keyboard-navigable combobox that presents entities by name and
 * yields the chosen entity's id. See the module doc for the loading/empty/error
 * behavior.
 */
export function EntitySelect<T>({
  label,
  items,
  getId,
  getLabel,
  value,
  onChange,
  loading = false,
  error = null,
  onRetry,
  emptyMessage = 'No options available.',
  placeholder = 'Select…',
  required = false,
  disabled = false,
  id,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: EntitySelectProps<T>): JSX.Element {
  // Error state takes precedence: offer an accessible alert + Retry (Req 3.8).
  if (error !== null) {
    return (
      <Stack gap="xs">
        <Text component="label" fw={500} size="sm">
          {label}
        </Text>
        <Alert role="alert" color="red" title="Failed to load options">
          <Stack gap="xs" align="flex-start">
            <Text size="sm">{error}</Text>
            {onRetry ? (
              <Button size="xs" variant="light" onClick={onRetry}>
                Retry
              </Button>
            ) : null}
          </Stack>
        </Alert>
      </Stack>
    );
  }

  // Empty state: an accessible status note with no free-text id fallback (Req 3.7).
  // Suppressed while loading so the spinner is the sole indicator.
  if (!loading && items.length === 0) {
    return (
      <Stack gap="xs">
        <Text component="label" fw={500} size="sm">
          {label}
        </Text>
        <Text role="status" c="dimmed" size="sm">
          {emptyMessage}
        </Text>
      </Stack>
    );
  }

  const options = buildOptions(items, getId, getLabel);

  return (
    <Select
      id={id}
      label={label}
      data={options}
      value={value}
      onChange={(next) => onChange(next)}
      placeholder={placeholder}
      required={required}
      // While loading the options are not yet selectable (Req 3.6).
      disabled={disabled || loading}
      rightSection={loading ? <Loader size="xs" /> : undefined}
      searchable
      nothingFoundMessage={emptyMessage}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
    />
  );
}
