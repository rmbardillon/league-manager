/**
 * Fallback page for unmatched routes.
 */
import { Link } from 'react-router-dom';

export function NotFoundPage(): JSX.Element {
  return (
    <section aria-labelledby="notfound-heading">
      <h2 id="notfound-heading">Page not found</h2>
      <p>The page you requested does not exist.</p>
      <Link to="/">Return home</Link>
    </section>
  );
}
