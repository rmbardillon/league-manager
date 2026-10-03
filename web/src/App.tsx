/**
 * Application root and route table.
 *
 * `App` is the composition root: it wraps the app in the {@link AuthProvider}
 * and a {@link BrowserRouter}, then renders {@link AppRoutes}. `AppRoutes` is
 * exported separately (without a router) so tests can mount it inside a
 * `MemoryRouter` at any initial path.
 *
 * Route map:
 *   - `/`            home (links to public views)
 *   - `/schedule`    public schedule (Req 10.1, 10.6)
 *   - `/results`     public results (Req 10.3, 10.6)
 *   - `/standings`   public standings (Req 10.4, 10.6)
 *   - `/awards`      published awards (Req 13.15)
 *   - `/signin`      credential sign-in (Req 1.1)
 *   - `/manage`      management home (auth-gated)
 *   - `/manage/teams`   Team management (Administrator-only, Req 3.1)
 *   - `/manage/players` roster management (auth-gated, Req 4.1)
 *   - `/manage/seasons`     Season management (Administrator-only, Req 8.1)
 *   - `/manage/tournaments` Tournament management (Administrator-only, Req 9.1)
 *   - `/manage/playoffs`    Playoff management (Administrator-only, Req 4.1)
 *   - `*`            not-found fallback
 */
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext.js';
import { ProtectedRoute } from './auth/ProtectedRoute.js';
import { Layout } from './components/Layout.js';
import { HomePage } from './pages/HomePage.js';
import { SignInPage } from './pages/SignInPage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { SchedulePage } from './pages/public/SchedulePage.js';
import { ResultsPage } from './pages/public/ResultsPage.js';
import { StandingsPage } from './pages/public/StandingsPage.js';
import { AwardsPage } from './pages/public/AwardsPage.js';
import { ManageHome } from './pages/manage/ManageHome.js';
import { TeamsPage } from './pages/manage/TeamsPage.js';
import { PlayersPage } from './pages/manage/PlayersPage.js';
import { SeasonsPage } from './pages/manage/SeasonsPage.js';
import { TournamentsPage } from './pages/manage/TournamentsPage.js';
import { PlayoffsPage } from './pages/manage/PlayoffsPage.js';

/** The route table, router-agnostic so it can be mounted in tests. */
export function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="schedule" element={<SchedulePage />} />
        <Route path="results" element={<ResultsPage />} />
        <Route path="standings" element={<StandingsPage />} />
        <Route path="awards" element={<AwardsPage />} />
        <Route path="signin" element={<SignInPage />} />
        <Route
          path="manage"
          element={
            <ProtectedRoute>
              <ManageHome />
            </ProtectedRoute>
          }
        />
        <Route
          path="manage/teams"
          element={
            <ProtectedRoute requireAdmin>
              <TeamsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="manage/players"
          element={
            <ProtectedRoute>
              <PlayersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="manage/seasons"
          element={
            <ProtectedRoute requireAdmin>
              <SeasonsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="manage/tournaments"
          element={
            <ProtectedRoute requireAdmin>
              <TournamentsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="manage/playoffs"
          element={
            <ProtectedRoute requireAdmin>
              <PlayoffsPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

/** Composition root: auth + router + routes. */
export function App(): JSX.Element {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
