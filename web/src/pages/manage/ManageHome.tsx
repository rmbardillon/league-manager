/**
 * Management landing page.
 *
 * Greets the signed-in principal and links to the management tasks available
 * to their role: Team management is Administrator-only (Req 2.4, 3.1); roster
 * management is open to Administrators and Team_Managers (Req 4.1, 4.4).
 */
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.js';

export function ManageHome(): JSX.Element {
  const { user, isAdmin } = useAuth();

  return (
    <section aria-labelledby="manage-heading">
      <h2 id="manage-heading">Management</h2>
      <p>
        Signed in as <strong>{user?.username}</strong>
        {user?.role ? ` (${user.role})` : ' (no role assigned)'}.
      </p>
      <nav aria-label="Management tasks">
        <ul>
          {isAdmin && (
            <li>
              <Link to="/manage/teams">Manage Teams</Link>
            </li>
          )}
          <li>
            <Link to="/manage/players">Manage Roster</Link>
          </li>
        </ul>
      </nav>
    </section>
  );
}
