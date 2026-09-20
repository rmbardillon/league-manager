/**
 * Authentication context and provider (Req 1.1, 1.5).
 *
 * Holds the authenticated principal for the SPA and exposes `signIn`/`signOut`
 * plus role helpers. The session itself lives in an HTTP-only cookie managed by
 * the backend; this context never sees the token. On mount it restores state by
 * calling `GET /auth/me` — a 401 simply means "not signed in" and leaves the
 * user anonymous rather than surfacing an error.
 *
 * `signIn` returns the resolved principal so callers (the sign-in page) can
 * redirect based on role; failures propagate as {@link ApiError} so the form
 * can render the generic, non-disclosing message (Req 1.3).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, authApi, type AuthUser, type Role } from '../api/index.js';

/** The value exposed by {@link AuthContext}. */
export interface AuthContextValue {
  /** The signed-in principal, or null when anonymous. */
  user: AuthUser | null;
  /** True until the initial `GET /auth/me` restore completes. */
  loading: boolean;
  /** True when a principal is present. */
  isAuthenticated: boolean;
  /** True when the principal is an Administrator (Req 2.4). */
  isAdmin: boolean;
  /** True when the principal is a Team_Manager (Req 4.4). */
  isTeamManager: boolean;
  /** Sign in and store the principal; resolves to it for role-based redirects. */
  signIn: (username: string, password: string) => Promise<AuthUser>;
  /** Sign out and clear the principal (Req 1.5). */
  signOut: () => Promise<void>;
  /** True when the principal manages the given Team (Req 4.4). */
  canManageTeam: (teamId: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Does a role grant management access to any Team? */
function roleCanManage(role: Role | null): boolean {
  return role === 'Administrator' || role === 'Team_Manager';
}

/**
 * Wrap the app so descendants can read auth state and call sign-in/out. Runs a
 * one-shot session restore on mount.
 */
export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    authApi
      .me(controller.signal)
      .then((principal) => setUser(principal))
      .catch((error: unknown) => {
        // A 401 is the expected "anonymous" case; anything else we also treat
        // as anonymous for restore purposes (the user can retry sign-in).
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setUser(null);
      })
      .finally(() => {
        // Ignore the finally when the effect was aborted mid-flight.
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const signIn = useCallback(async (username: string, password: string): Promise<AuthUser> => {
    const principal = await authApi.signIn({ username, password });
    setUser(principal);
    return principal;
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await authApi.signOut();
    } catch (error: unknown) {
      // An already-expired session still means "signed out" locally; only
      // rethrow unexpected non-auth failures.
      if (error instanceof ApiError && error.isUnauthenticated) {
        // fall through to clearing state
      } else if (error instanceof ApiError) {
        setUser(null);
        throw error;
      }
    }
    setUser(null);
  }, []);

  const canManageTeam = useCallback(
    (teamId: string): boolean => {
      if (!user) return false;
      if (user.role === 'Administrator') return true;
      return user.role === 'Team_Manager' && user.managedTeamIds.includes(teamId);
    },
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      isAuthenticated: user !== null,
      isAdmin: user?.role === 'Administrator',
      isTeamManager: user?.role === 'Team_Manager',
      signIn,
      signOut,
      canManageTeam,
    }),
    [user, loading, signIn, signOut, canManageTeam],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Read the auth context; throws if used outside an {@link AuthProvider}. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }
  return ctx;
}

export { roleCanManage };
