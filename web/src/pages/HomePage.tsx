/**
 * Landing page describing the public and management areas of the app.
 */
import { Link } from 'react-router-dom';

export function HomePage(): JSX.Element {
  return (
    <section aria-labelledby="home-heading">
      <h2 id="home-heading">Welcome</h2>
      <p>
        Browse the league without signing in, or sign in to manage Teams and
        rosters.
      </p>
      <nav aria-label="Public browsing">
        <ul>
          <li>
            <Link to="/schedule">Schedule</Link>
          </li>
          <li>
            <Link to="/results">Results</Link>
          </li>
          <li>
            <Link to="/standings">Standings</Link>
          </li>
          <li>
            <Link to="/awards">Published Awards</Link>
          </li>
        </ul>
      </nav>
    </section>
  );
}
