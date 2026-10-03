/**
 * Playoff round-type selector (Req 9.2).
 *
 * A static-value {@link EntitySelect} over the valid {@link PlayoffRoundType}
 * values, so the create-Round form can only offer a valid round type.
 */
import type { PlayoffRoundType } from '../../api';
import { EntitySelect } from './EntitySelect.js';

interface RoundTypeOption {
  id: PlayoffRoundType;
  name: string;
}

/** The complete, closed set of valid playoff round types. */
const ROUND_TYPE_OPTIONS: readonly RoundTypeOption[] = [
  { id: 'Quarterfinals', name: 'Quarterfinals' },
  { id: 'Semifinals', name: 'Semifinals' },
  { id: 'Finals', name: 'Finals' },
];

export interface PlayoffRoundTypeSelectProps {
  /** The currently selected round type, or `null` when nothing is selected. */
  value: PlayoffRoundType | null;
  /** Called with the selected round type (or `null` when cleared). */
  onChange: (value: PlayoffRoundType | null) => void;
  /** Programmatic label for the combobox. */
  label?: string;
  /** Whether a selection is required. */
  required?: boolean;
  /** Disable the control. */
  disabled?: boolean;
}

/**
 * A labeled combobox over the valid {@link PlayoffRoundType} values. The
 * underlying {@link EntitySelect} value is the round-type string itself.
 */
export function PlayoffRoundTypeSelect({
  value,
  onChange,
  label = 'Round type',
  required = false,
  disabled = false,
}: PlayoffRoundTypeSelectProps): JSX.Element {
  return (
    <EntitySelect
      label={label}
      items={ROUND_TYPE_OPTIONS as RoundTypeOption[]}
      getId={(item) => item.id}
      getLabel={(item) => item.name}
      value={value}
      onChange={(id) => onChange(id as PlayoffRoundType | null)}
      required={required}
      disabled={disabled}
      placeholder="Select a round type…"
    />
  );
}
