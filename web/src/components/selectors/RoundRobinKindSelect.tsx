/**
 * Round-robin schedule-kind selector (Req 8.2, 8.3).
 *
 * A static-value {@link EntitySelect} over the two valid {@link RoundRobinKind}
 * values. Shown (and required) by the create-Tournament form only when the
 * chosen format is `round-robin`.
 */
import type { RoundRobinKind } from '../../api';
import { EntitySelect } from './EntitySelect.js';

interface KindOption {
  id: RoundRobinKind;
  name: string;
}

/** The complete, closed set of valid round-robin kinds. */
const KIND_OPTIONS: readonly KindOption[] = [
  { id: 'single', name: 'Single' },
  { id: 'double', name: 'Double' },
];

export interface RoundRobinKindSelectProps {
  /** The currently selected kind, or `null` when nothing is selected. */
  value: RoundRobinKind | null;
  /** Called with the selected kind (or `null` when cleared). */
  onChange: (value: RoundRobinKind | null) => void;
  /** Programmatic label for the combobox. */
  label?: string;
  /** Whether a selection is required. */
  required?: boolean;
  /** Disable the control. */
  disabled?: boolean;
}

/**
 * A labeled combobox over the valid {@link RoundRobinKind} values. The
 * underlying {@link EntitySelect} value is the kind string itself.
 */
export function RoundRobinKindSelect({
  value,
  onChange,
  label = 'Round-robin kind',
  required = false,
  disabled = false,
}: RoundRobinKindSelectProps): JSX.Element {
  return (
    <EntitySelect
      label={label}
      items={KIND_OPTIONS as KindOption[]}
      getId={(item) => item.id}
      getLabel={(item) => item.name}
      value={value}
      onChange={(id) => onChange(id as RoundRobinKind | null)}
      required={required}
      disabled={disabled}
      placeholder="Select a kind…"
    />
  );
}
