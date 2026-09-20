/**
 * A labeled Season selector for the public browsing views.
 *
 * The public schedule/results/standings/awards endpoints are keyed by a Season
 * (or scope) id, so each public view needs a way to specify which Season to
 * view. This control reads and writes the `season` URL query parameter so a
 * view is deep-linkable and the choice persists across the public tabs.
 *
 * It is a plain labeled text input inside a `<form>` so it is keyboard-operable
 * and screen-reader friendly (the label is programmatically associated with the
 * input via `htmlFor`/`id`).
 */
import { useState, type FormEvent } from 'react';

export interface SeasonPickerProps {
  /** The currently active id (from the URL). */
  value: string;
  /** Called with the trimmed id when the user submits. */
  onChange: (seasonId: string) => void;
  /** Field label; defaults to "Season ID". */
  label?: string;
  /** id of the input, so callers can wire additional descriptions if needed. */
  inputId?: string;
}

export function SeasonPicker({
  value,
  onChange,
  label = 'Season ID',
  inputId = 'season-id',
}: SeasonPickerProps): JSX.Element {
  const [draft, setDraft] = useState(value);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onChange(draft.trim());
  };

  return (
    <form className="season-picker" onSubmit={handleSubmit} role="search">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        name="season"
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        autoComplete="off"
        placeholder="Enter a Season ID"
      />
      <button type="submit">View</button>
    </form>
  );
}
