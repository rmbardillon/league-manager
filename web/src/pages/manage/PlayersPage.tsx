/**
 * Roster (Player) management view (Req 4.1, 4.5, 4.7).
 *
 * An Administrator or the managing Team_Manager adds, updates, and removes
 * Players on a Team's roster. The Team is chosen via the `team` URL query
 * parameter (deep-linked from the Teams view). The backend enforces name length
 * (Req 4.3), jersey range and uniqueness (Req 4.2, 4.3), and team-scoped
 * authorization (Req 4.4); this view surfaces returned errors inline.
 *
 * Because the backend exposes no roster-list read, the view tracks Players added
 * during the session. When the signed-in principal cannot manage the entered
 * Team, the mutation controls are disabled and a notice explains why (Req 4.4).
 */
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, playersApi, type Player } from '../../api/index.js';
import { useAuth } from '../../auth/AuthContext.js';
import { ErrorMessage } from '../../components/Feedback.js';
import { SeasonPicker } from '../../components/SeasonPicker.js';

export function PlayersPage(): JSX.Element {
  const { canManageTeam } = useAuth();
  const [params, setParams] = useSearchParams();
  const teamId = params.get('team') ?? '';

  const [players, setPlayers] = useState<Player[]>([]);
  const [name, setName] = useState('');
  const [jersey, setJersey] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const allowed = teamId !== '' && canManageTeam(teamId);

  const setTeam = (id: string): void => {
    setParams(id ? { team: id } : {});
    setPlayers([]);
  };

  const handleAdd = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setAddError(null);
    const jerseyNumber = Number(jersey);
    if (!Number.isInteger(jerseyNumber)) {
      setAddError('Jersey number must be a whole number between 0 and 99.');
      return;
    }
    setAdding(true);
    try {
      const player = await playersApi.add({ teamId, name: name.trim(), jerseyNumber });
      setPlayers((prev) => [...prev, player]);
      setName('');
      setJersey('');
    } catch (err: unknown) {
      setAddError(err instanceof ApiError ? err.message : 'Failed to add the Player.');
    } finally {
      setAdding(false);
    }
  };

  const handleUpdate = async (player: Player): Promise<void> => {
    const nextName = window.prompt(`New name for "${player.name}"`, player.name);
    if (nextName === null) return;
    const nextJersey = window.prompt('New jersey number (0–99)', String(player.jerseyNumber));
    if (nextJersey === null) return;
    setRowError(null);
    try {
      const updated = await playersApi.update(player.id, {
        name: nextName.trim(),
        jerseyNumber: Number(nextJersey),
      });
      setPlayers((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch (err: unknown) {
      setRowError(err instanceof ApiError ? err.message : 'Failed to update the Player.');
    }
  };

  const handleRemove = async (player: Player): Promise<void> => {
    if (!window.confirm(`Remove "${player.name}" from the roster?`)) return;
    setRowError(null);
    try {
      await playersApi.remove(player.id);
      setPlayers((prev) => prev.filter((p) => p.id !== player.id));
    } catch (err: unknown) {
      setRowError(err instanceof ApiError ? err.message : 'Failed to remove the Player.');
    }
  };

  return (
    <section aria-labelledby="players-heading">
      <h2 id="players-heading">Manage Roster</h2>
      <SeasonPicker value={teamId} onChange={setTeam} label="Team ID" inputId="roster-team-id" />

      {teamId === '' && <p role="status">Enter a Team ID to manage its roster.</p>}

      {teamId !== '' && !allowed && (
        <p role="alert">You are not authorized to manage this Team&apos;s roster.</p>
      )}

      {allowed && (
        <>
          <h3>Add a Player</h3>
          <form onSubmit={handleAdd} noValidate>
            {addError && <ErrorMessage>{addError}</ErrorMessage>}
            <div className="field">
              <label htmlFor="player-name">Player name</label>
              <input
                id="player-name"
                name="name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                aria-required="true"
                maxLength={100}
              />
            </div>
            <div className="field">
              <label htmlFor="player-jersey">Jersey number</label>
              <input
                id="player-jersey"
                name="jerseyNumber"
                type="number"
                min={0}
                max={99}
                step={1}
                value={jersey}
                onChange={(event) => setJersey(event.target.value)}
                required
                aria-required="true"
              />
            </div>
            <button type="submit" disabled={adding}>
              {adding ? 'Adding…' : 'Add Player'}
            </button>
          </form>

          <h3>Players added this session</h3>
          {rowError && <ErrorMessage>{rowError}</ErrorMessage>}
          {players.length === 0 ? (
            <p role="status">No Players added yet in this session.</p>
          ) : (
            <table>
              <caption>Roster additions</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Jersey</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {players.map((player) => (
                  <tr key={player.id}>
                    <td>{player.name}</td>
                    <td>{player.jerseyNumber}</td>
                    <td>
                      <button type="button" onClick={() => void handleUpdate(player)}>
                        Edit
                      </button>{' '}
                      <button type="button" onClick={() => void handleRemove(player)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
