/**
 * Application shell: skip link, header navigation, and the main content region.
 *
 * Accessibility notes:
 *   - A "skip to main content" link is the first focusable element so keyboard
 *     users can bypass the navigation.
 *   - Primary navigation is a labeled `<nav>` of `NavLink`s; the active link is
 *     marked with `aria-current="page"`.
 *   - The routed content renders inside a `<main id="main-content">` landmark.
 *   - The auth controls show a sign-in link when anonymous and the username
 *     plus a sign-out button when signed in.
 */
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';

/** NavLink className callback: mark the active route for styling + a11y. */
function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'nav-link active' : 'nav-link';
}

export function Layout(): JSX.Element {
  const { isAuthenticated, isAdmin, user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async (): Promise<void> => {
    try {
      await signOut();
    } finally {
      navigate('/', { replace: true });
    }
  };

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header>
        <h1>Basketball League Management</h1>
        <nav aria-label="Primary">
          <ul>
            <li>
              <NavLink to="/" end className={navClass}>
                Home
              </NavLink>
            </li>
            <li>
              <NavLink to="/schedule" className={navClass}>
                Schedule
              </NavLink>
            </li>
            <li>
              <NavLink to="/results" className={navClass}>
                Results
              </NavLink>
            </li>
            <li>
              <NavLink to="/standings" className={navClass}>
                Standings
              </NavLink>
            </li>
            <li>
              <NavLink to="/awards" className={navClass}>
                Awards
              </NavLink>
            </li>
            {isAuthenticated && (
              <li>
                <NavLink to="/manage" className={navClass}>
                  Manage
                </NavLink>
              </li>
            )}
            {isAuthenticated && isAdmin && (
              <li>
                <NavLink to="/manage/teams" className={navClass}>
                  Teams
                </NavLink>
              </li>
            )}
            {isAuthenticated && isAdmin && (
              <li>
                <NavLink to="/manage/seasons" className={navClass}>
                  Seasons
                </NavLink>
              </li>
            )}
            {isAuthenticated && isAdmin && (
              <li>
                <NavLink to="/manage/tournaments" className={navClass}>
                  Tournaments
                </NavLink>
              </li>
            )}
            {isAuthenticated && isAdmin && (
              <li>
                <NavLink to="/manage/playoffs" className={navClass}>
                  Playoffs
                </NavLink>
              </li>
            )}
          </ul>
        </nav>
        <div className="auth-controls">
          {isAuthenticated ? (
            <>
              <span>Signed in as {user?.username}</span>{' '}
              <button type="button" onClick={() => void handleSignOut()}>
                Sign out
              </button>
            </>
          ) : (
            <NavLink to="/signin" className={navClass}>
              Sign in
            </NavLink>
          )}
        </div>
      </header>
      <main id="main-content">
        <Outlet />
      </main>
    </>
  );
}
