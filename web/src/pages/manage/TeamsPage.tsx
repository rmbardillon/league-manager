/**
 * Team management view (Req 3.1, 3.5, 3.7).
 *
 * Administrators create Teams in a Season and rename or delete existing Teams.
 * The backend exposes create/rename/delete but no Team-list read, so this view
 * tracks the Teams created during the session and lets the user rename or
 * delete any Team by acting on those entries (or by pasting a Team ID to
 * manage). All server-side rules — name length (Req 3.2), Season existence
 * (Req 3.3), case-insensitive uniqueness (Req 3.4), completed-Game deletion
 * gating (Req 3.8) — are enforced by the API; this view surfaces the returned
 * errors inline.
 *
 * The whole page is gated to Administrators by the route guard (Req 2.4).
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, teamsApi, type Team } from '../../api/index.js';
import { ErrorMessage } from '../../components/Feedback.js';

export function TeamsPage(): JSX.Element {
  const [teams, setTeams] = useState<Team[]>([]);
  const [seasonId, setSeasonId] = useState('');
  const [name, setName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const handleCreate = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const team = await teamsApi.create({ seasonId: seasonId.trim(), name: name.trim() });
      setTeams((prev) => [...prev, team]);
      setName('');
    } catch (err: unknown) {
      setCreateError(err instanceof ApiError ? err.message : 'Failed to create the Team.');
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async (team: Team): Promise<void> => {
    const nextName = window.prompt(`New name for "${team.name}"`, team.name);
    if (nextName === null) return;
    setRowError(null);
    try {
      const updated = await teamsApi.update(team.id, { name: nextName.trim() });
      setTeams((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err: unknown) {
      setRowError(err instanceof ApiError ? err.message : 'Failed to rename the Team.');
    }
  };

  const handleDelete = async (team: Team): Promise<void> => {
    if (!window.confirm(`Delete Team "${team.name}"? This cannot be undone.`)) return;
    setRowError(null);
    try {
      await teamsApi.remove(team.id);
      setTeams((prev) => prev.filter((t) => t.id !== team.id));
    } catch (err: unknown) {
      setRowError(err instanceof ApiError ? err.message : 'Failed to delete the Team.');
    }
  };

  return (
    <section aria-labelledby="teams-heading">
      <h2 id="teams-heading">Manage Teams</h2>

      <h3>Create a Team</h3>
      <form onSubmit={handleCreate} noValidate>
        {createError && <ErrorMessage>{createError}</ErrorMessage>}
        <div className="field">
          <label htmlFor="team-season-id">Season ID</label>
          <input
            id="team-season-id"
            name="seasonId"
            type="text"
            value={seasonId}
            onChange={(event) => setSeasonId(event.target.value)}
            required
            aria-required="true"
          />
        </div>
        <div className="field">
          <label htmlFor="team-name">Team name</label>
          <input
            id="team-name"
            name="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            aria-required="true"
            maxLength={100}
          />
        </div>
        <button type="submit" disabled={creating}>
          {creating ? 'Creating…' : 'Create Team'}
        </button>
      </form>

      <h3>Teams created this session</h3>
      {rowError && <ErrorMessage>{rowError}</ErrorMessage>}
      {teams.length === 0 ? (
        <p role="status">No Teams created yet in this session.</p>
      ) : (
        <table>
          <caption>Teams you have created</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Team ID</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <tr key={team.id}>
                <td>{team.name}</td>
                <td>
                  <code>{team.id}</code>
                </td>
                <td>
                  <button type="button" onClick={() => void handleRename(team)}>
                    Rename
                  </button>{' '}
                  <button type="button" onClick={() => void handleDelete(team)}>
                    Delete
                  </button>{' '}
                  <Link to={`/manage/players?team=${encodeURIComponent(team.id)}`}>
                    Manage roster
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
