/**
 * Public browsing endpoints (Requirement 10).
 *
 * Read-only schedule, results, and Standings for a Season that any Viewer can
 * request WITHOUT signing in (Req 10.6). These routes attach no authentication
 * or authorization middleware — the transport layer wires them onto the app
 * ahead of any auth-guarded router.
 *
 * The three endpoints:
 *
 *   - GET /public/seasons/:seasonId/schedule (Req 10.1, 10.2)
 *       All official, non-cancelled scheduled Games of the Season, ordered by
 *       date then start time ascending, each entry exposing its date, start
 *       time, Venue name, and both participating Teams' names. When the Season
 *       has no such Games the response is an informational payload with an
 *       empty list — never an error (Req 10.2).
 *
 *   - GET /public/seasons/:seasonId/results (Req 10.3)
 *       Every completed Game of the Season showing both Teams' final Scores and
 *       the date the Game was completed. An empty result set is likewise an
 *       informational payload, not an error.
 *
 *   - GET /public/seasons/:seasonId/standings (Req 10.4, 10.5)
 *       The Season's Standings. An open Season is computed live and ordered by
 *       wins descending with each row's wins, losses, and rank (Req 10.4); a
 *       closed Season returns the snapshot recorded at close time (Req 10.5).
 *       Team names are attached for display. Both cases delegate the open-vs-
 *       closed rule to {@link StandingsService}.
 *
 * A request for a Season that does not exist yields a 404 NotFoundError. A
 * Season that exists but has no matching Games or Teams yields an empty,
 * informational payload rather than an error.
 *
 * _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { NotFoundError } from '../../domain/errors.js';
import type { Award, Game, Score, Season, StandingRow, Team } from '../../domain/types.js';
import type { Database, Executor } from '../../repositories/executor.js';
import { withTransaction } from '../../repositories/executor.js';
import {
  awardRepository,
  gameRepository,
  leagueRepository,
  scoreRepository,
  seasonRepository,
  teamRepository,
} from '../../repositories/index.js';
import { StandingsService } from '../../services/standingsService.js';

// ---------------------------------------------------------------------------
// Response payload shapes
// ---------------------------------------------------------------------------

/** One row of the public schedule (Req 10.1). */
export interface ScheduleEntry {
  gameId: string;
  /** ISO date (YYYY-MM-DD) the Game is scheduled for. */
  date: string;
  /** Start time of day, e.g. "18:30". */
  startTime: string | null;
  /** Venue name. */
  venue: string | null;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
}

/** The public schedule response (Req 10.1, 10.2). */
export interface SchedulePayload {
  seasonId: string;
  games: ScheduleEntry[];
  /** Informational message; present when there are no scheduled Games (Req 10.2). */
  message?: string;
}

/** One row of the public results view (Req 10.3). */
export interface ResultEntry {
  gameId: string;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  /** ISO timestamp the Game was completed. */
  completedAt: string;
}

/** The public results response (Req 10.3). */
export interface ResultsPayload {
  seasonId: string;
  games: ResultEntry[];
  /** Informational message; present when there are no completed Games. */
  message?: string;
}

/** One row of the public Standings view (Req 10.4). */
export interface StandingEntry {
  rank: number;
  teamId: string;
  teamName: string;
  wins: number;
  losses: number;
}

/** The public Standings response (Req 10.4, 10.5). */
export interface StandingsPayload {
  seasonId: string;
  /** True when the Season is closed and the snapshot is returned (Req 10.5). */
  closed: boolean;
  standings: StandingEntry[];
  /** Informational message; present when there are no ranked Teams. */
  message?: string;
}

/**
 * The public published-Awards response for a scope (Req 13.14, 13.15).
 *
 * Viewers see exactly the published subset of a scope's Awards. An unknown
 * scope, or a scope with no published Awards, yields an empty list with an
 * informational message rather than a 404 — a Viewer cannot distinguish an
 * unknown scope from one whose Awards are not yet published.
 */
export interface PublishedAwardsPayload {
  scopeId: string;
  awards: Award[];
  /** Informational message; present when there are no published Awards. */
  message?: string;
}

/**
 * The browsing-safe projection of a Season for the public Season Selector
 * (Req 7.4, 7.6).
 *
 * Exposes exactly the fields a Viewer needs to pick a Season by name — its
 * Identifier, name, and closed flag — and nothing restricted to authenticated
 * management flows (never `leagueId`, `startDate`, `endDate`, or
 * `finalStandingsSnapshot`).
 */
export interface PublicSeasonSummary {
  id: string;
  name: string;
  closed: boolean;
}

/**
 * The public Seasons list response (Req 7.4, 7.5). Lists every Season
 * available for public browsing across all Leagues. When none exist the
 * response is an informational payload with an empty list — never a 404
 * (Req 7.5).
 */
export interface PublicSeasonsPayload {
  seasons: PublicSeasonSummary[];
  /** Informational message; present when there are no Seasons to browse. */
  message?: string;
}

// ---------------------------------------------------------------------------
// Helpers (pure, I/O-free)
// ---------------------------------------------------------------------------

/**
 * Normalize a route parameter to a single string. Express types a path param
 * as `string | string[]`; a `:seasonId` segment always resolves to a single
 * value, so collapse the (never-taken) array case to its first element.
 */
function paramValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/** Build a Team-id → name lookup from a Season's Teams. */
function teamNameMap(teams: Team[]): Map<string, string> {
  return new Map(teams.map((t) => [t.id, t.name]));
}

/**
 * Project a Season onto its browsing-safe public summary (Req 7.6).
 *
 * Returns exactly `{id, name, closed}` and deliberately drops every
 * management-only field (`leagueId`, `startDate`, `endDate`,
 * `finalStandingsSnapshot`) so the public Selector never leaks data restricted
 * to authenticated flows. Pure and I/O-free.
 */
export function toPublicSeason(season: Season): PublicSeasonSummary {
  return { id: season.id, name: season.name, closed: season.closed };
}

/** Format a Date as an ISO calendar date (YYYY-MM-DD). */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Total order for schedule entries: date ascending, then start time ascending
 * (Req 10.1). A `null` start time sorts before any concrete time so draft-less
 * official Games without a time still order deterministically; ties fall back
 * to the Game id so the ordering is stable and total.
 */
function compareSchedule(a: Game, b: Game): number {
  const dateDelta = a.date.getTime() - b.date.getTime();
  if (dateDelta !== 0) return dateDelta;

  const at = a.startTime ?? '';
  const bt = b.startTime ?? '';
  if (at < bt) return -1;
  if (at > bt) return 1;

  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * A Game belongs on the public schedule iff it is official (submitted, not a
 * draft), still scheduled (not completed), and not cancelled (Req 10.1). Draft
 * Games are invisible to the public until submitted (Property 32).
 */
function isPublicScheduleGame(game: Game): boolean {
  return game.scheduleState === 'official' && game.status === 'scheduled';
}

// ---------------------------------------------------------------------------
// Data assembly (transactional reads)
// ---------------------------------------------------------------------------

/**
 * Assert the Season exists so a request for an unknown Season surfaces a 404
 * rather than being confused with an empty-but-valid Season.
 */
async function requireSeason(seasonId: string, ex: Executor): Promise<void> {
  const season = await seasonRepository.findById(seasonId, ex);
  if (!season) {
    throw new NotFoundError('The specified Season does not exist.', { seasonId });
  }
}

/** Build the schedule payload for a Season (Req 10.1, 10.2). */
async function buildSchedule(seasonId: string, ex: Executor): Promise<SchedulePayload> {
  await requireSeason(seasonId, ex);

  const [teams, games] = await Promise.all([
    teamRepository.listBySeason(seasonId, ex),
    gameRepository.listBySeason(seasonId, ex),
  ]);
  const names = teamNameMap(teams);

  const entries: ScheduleEntry[] = games
    .filter(isPublicScheduleGame)
    .sort(compareSchedule)
    .map((game) => ({
      gameId: game.id,
      date: toIsoDate(game.date),
      startTime: game.startTime,
      venue: game.venue,
      homeTeamId: game.homeTeamId,
      homeTeamName: names.get(game.homeTeamId) ?? '',
      awayTeamId: game.awayTeamId,
      awayTeamName: names.get(game.awayTeamId) ?? '',
    }));

  const payload: SchedulePayload = { seasonId, games: entries };
  if (entries.length === 0) {
    // Req 10.2: no scheduled Games → informational message, not an error.
    payload.message = 'No Games are scheduled for this Season.';
  }
  return payload;
}

/** Build the results payload for a Season (Req 10.3). */
async function buildResults(seasonId: string, ex: Executor): Promise<ResultsPayload> {
  await requireSeason(seasonId, ex);

  const [teams, games] = await Promise.all([
    teamRepository.listBySeason(seasonId, ex),
    gameRepository.listBySeason(seasonId, ex),
  ]);
  const names = teamNameMap(teams);

  const completed = games.filter((game) => game.status === 'completed');

  const entries: ResultEntry[] = [];
  for (const game of completed) {
    const score: Score | null = await scoreRepository.findByGame(game.id, ex);
    // A completed Game is expected to carry a Score; guard defensively so a
    // missing Score is simply excluded rather than surfacing an error.
    if (!score) continue;
    entries.push({
      gameId: game.id,
      homeTeamId: game.homeTeamId,
      homeTeamName: names.get(game.homeTeamId) ?? '',
      awayTeamId: game.awayTeamId,
      awayTeamName: names.get(game.awayTeamId) ?? '',
      homeScore: score.homeScore,
      awayScore: score.awayScore,
      completedAt: score.completedAt.toISOString(),
    });
  }

  // Present results in completion order (most recent last) for a stable view.
  entries.sort((a, b) => {
    if (a.completedAt < b.completedAt) return -1;
    if (a.completedAt > b.completedAt) return 1;
    return a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0;
  });

  const payload: ResultsPayload = { seasonId, games: entries };
  if (entries.length === 0) {
    payload.message = 'No completed Games are available for this Season yet.';
  }
  return payload;
}

/**
 * Build the public Seasons payload (Req 7.4, 7.5). Reads every League's Seasons
 * in one snapshot and projects each via {@link toPublicSeason}. An empty result
 * yields an informational payload with an empty list, never a 404 (Req 7.5).
 */
async function buildPublicSeasons(ex: Executor): Promise<PublicSeasonsPayload> {
  const leagues = await leagueRepository.list(ex);
  const seasonLists = await Promise.all(
    leagues.map((league) => seasonRepository.listByLeague(league.id, ex)),
  );
  const seasons = seasonLists.flat().map(toPublicSeason);

  const payload: PublicSeasonsPayload = { seasons };
  if (seasons.length === 0) {
    payload.message = 'No Seasons are available for browsing yet.';
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/**
 * Build the public browsing {@link Router}. All routes are read-only and
 * unauthenticated (Req 10.6).
 *
 * The Standings endpoint delegates the open-vs-closed rule to
 * {@link StandingsService}, then attaches Team names for display. The schedule
 * and results endpoints run their reads inside a single {@link withTransaction}
 * unit so each response reflects one consistent database snapshot.
 *
 * @param db The database handle used for the read transactions.
 */
export function createPublicRouter(db: Database): Router {
  const router = Router();
  const standingsService = new StandingsService(db);

  const wrap =
    (handler: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction): void => {
      handler(req, res).catch(next);
    };

  router.get(
    '/seasons',
    wrap(async (_req, res) => {
      // Lists every browsable Season across all Leagues for the public Season
      // Selector. No authentication (Req 7.4); empty → informational payload,
      // never a 404 (Req 7.5).
      const payload = await withTransaction(db, (tx) => buildPublicSeasons(tx));
      res.json(payload);
    }),
  );

  router.get(
    '/seasons/:seasonId/schedule',
    wrap(async (req, res) => {
      const seasonId = paramValue(req.params.seasonId);
      const payload = await withTransaction(db, (tx) => buildSchedule(seasonId, tx));
      res.json(payload);
    }),
  );

  router.get(
    '/seasons/:seasonId/results',
    wrap(async (req, res) => {
      const seasonId = paramValue(req.params.seasonId);
      const payload = await withTransaction(db, (tx) => buildResults(seasonId, tx));
      res.json(payload);
    }),
  );

  router.get(
    '/seasons/:seasonId/standings',
    wrap(async (req, res) => {
      const seasonId = paramValue(req.params.seasonId);

      // StandingsService handles the open (live) vs closed (snapshot) rule and
      // throws NotFoundError for an unknown Season (Req 10.4, 10.5).
      const rows: StandingRow[] = await standingsService.computeStandings(seasonId);

      // Attach Team names and the closed flag for display. Read Teams and the
      // Season flag in one snapshot.
      const { closed, standings } = await withTransaction(db, async (tx) => {
        const season = await seasonRepository.findById(seasonId, tx);
        const teams = await teamRepository.listBySeason(seasonId, tx);
        const names = teamNameMap(teams);
        const entries: StandingEntry[] = rows.map((row) => ({
          rank: row.rank,
          teamId: row.teamId,
          teamName: names.get(row.teamId) ?? '',
          wins: row.wins,
          losses: row.losses,
        }));
        return { closed: season?.closed ?? false, standings: entries };
      });

      const payload: StandingsPayload = { seasonId, closed, standings };
      if (standings.length === 0) {
        payload.message = 'No Standings are available for this Season yet.';
      }
      res.json(payload);
    }),
  );

  router.get(
    '/scopes/:scopeId/awards',
    wrap(async (req, res) => {
      const scopeId = paramValue(req.params.scopeId);

      // Viewers see only published Awards. An unknown scope is not a 404: it
      // simply has no published Awards, indistinguishable from a scope whose
      // Awards are unpublished (Req 13.14, 13.15).
      const awards = (await awardRepository.listByScope(scopeId, db)).filter(
        (award) => award.published,
      );

      const payload: PublishedAwardsPayload = { scopeId, awards };
      if (awards.length === 0) {
        payload.message = 'No published Awards are available for this scope yet.';
      }
      res.json(payload);
    }),
  );

  return router;
}

/**
 * Register the public browsing routes on an Express app (or any Router-capable
 * target) under the `/public` prefix.
 *
 * Kept separate from the app factory so the transport layer can decide exactly
 * where the unauthenticated public routes mount relative to the auth-guarded
 * routers, without this module importing the app.
 *
 * @param app The Express application (or parent Router) to mount onto.
 * @param db  The database handle backing the read endpoints.
 *
 * @example
 * const app = createApp();
 * registerPublicRoutes(app, db);
 */
export function registerPublicRoutes(
  app: { use: (path: string, router: Router) => unknown },
  db: Database,
): void {
  app.use('/public', createPublicRouter(db));
}
