/**
 * Route guard for authenticated management views.
 *
 * Renders its children only for a signed-in principal; while the initial
 * session restore is in flight it shows a loading status, and an anonymous
 * visitor is redirected to the sign-in page with the originally requested path
 * captured in router state so sign-in can send them back.
 *
 * An optional `requireAdmin` flag restricts a route to Administrators (Req 2.4);
 * a non-admin principal is shown an authorization notice rather than being
 * redirected, since they are already signed in.
 */
import { Navigate, useLocation, type Location } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext.js';
import { LoadingIndicator } from '../components/Feedback.js';

export interface ProtectedRouteProps {
  children: ReactNode;
  /** When true, only Administrators may view the route (Req 2.4). */
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps): JSX.Element {
  const { isAuthenticated, isAdmin, loading } = useAuth();
  const location = useLocation() as Location;

  if (loading) {
    return <LoadingIndicator label="Checking your session…" />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/signin" replace state={{ from: location.pathname + location.search }} />;
  }

  if (requireAdmin && !isAdmin) {
    return (
      <section aria-labelledby="forbidden-heading">
        <h2 id="forbidden-heading">Not authorized</h2>
        <p role="alert">This area requires Administrator access.</p>
      </section>
    );
  }

  return <>{children}</>;
}
