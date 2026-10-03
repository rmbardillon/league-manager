/**
 * Best-of series-length selector (Req 9.4).
 *
 * A static-value {@link EntitySelect} over the valid {@link BestOf} lengths.
 *
 * `BestOf` is numeric, but {@link EntitySelect} follows a string-value contract
 * (every option `value` is a string id). So the options are
 * `{ id: '1', name: 'Best of 1' }` etc. and {@link BestOfSelect} surfaces the
 * chosen value as the string id via `onChange`. Consuming pages parse that id
 * back to the numeric `BestOf` (e.g. with {@link parseBestOf}) before sending
 * it to the API.
 */
import type { BestOf } from '../../api';
import { EntitySelect } from './EntitySelect.js';

interface BestOfOption {
  id: string;
  name: string;
}

/** The complete, closed set of valid best-of lengths. */
const BEST_OF_VALUES: readonly BestOf[] = [1, 3, 5, 7];

const BEST_OF_OPTIONS: readonly BestOfOption[] = BEST_OF_VALUES.map((n) => ({
  id: String(n),
  name: `Best of ${n}`,
}));

/**
 * Parse a {@link BestOfSelect} string id back to the numeric {@link BestOf},
 * or `null` when the id is `null`/not a valid best-of length. Pure helper for
 * consuming pages to map the select's string value to the API's numeric type.
 */
export function parseBestOf(id: string | null): BestOf | null {
  if (id === null) {
    return null;
  }
  const n = Number(id);
  return (BEST_OF_VALUES as number[]).includes(n) ? (n as BestOf) : null;
}

export interface BestOfSelectProps {
  /** The currently selected best-of length as a string id, or `null`. */
  value: string | null;
  /** Called with the selected best-of string id (or `null` when cleared). */
  onChange: (id: string | null) => void;
  /** Programmatic label for the combobox. */
  label?: string;
  /** Whether a selection is required. */
  required?: boolean;
  /** Disable the control. */
  disabled?: boolean;
}

/**
 * A labeled combobox over the valid {@link BestOf} lengths. The underlying
 * {@link EntitySelect} value is the stringified number (`'1'`, `'3'`, …);
 * consuming pages map it back to the numeric `BestOf` via {@link parseBestOf}.
 */
export function BestOfSelect({
  value,
  onChange,
  label = 'Best of',
  required = false,
  disabled = false,
}: BestOfSelectProps): JSX.Element {
  return (
    <EntitySelect
      label={label}
      items={BEST_OF_OPTIONS as BestOfOption[]}
      getId={(item) => item.id}
      getLabel={(item) => item.name}
      value={value}
      onChange={onChange}
      required={required}
      disabled={disabled}
      placeholder="Select a series length…"
    />
  );
}
