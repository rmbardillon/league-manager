/**
 * Management-side Game read endpoints (Requirement 5 / 12 support).
 *
 * The public browsing routes only expose official, non-cancelled Games. The
 * management UI (manual scheduling, scoring, automatic-schedule review) needs
 * to read every Game of a Season regardless of state - draft or official,
 * scheduled, completed, or cancelled - plus the recorded Score when present.
 * These authenticated, Administrator-only reads provide that surface without
 * touching the mutating routers.
 *
 *   - GET /seasons/:seasonId/games   list every Game of a Season (all states),
 *                                    each with both Team names and the Score
 *                                    when the Game is completed. Unknown Season
 *                                    -> 404; a Season with no Games -> [].
 *   - GET /games/:gameId             one Game's full record (404 if absent).
 *
 * Reads run inside a single withTransaction snapshot. Dates cross the wire as
 * ISO strings. The list is ordered by date asc, then start time asc, then id so
 * the ordering is stable and total.
 *
 * _Requirements: 5.1, 5.6, 5.8, 12.2_
 */
import { Router } from 'express';
import { authenticate, authorizeRoleRequest } from '../middleware/auth.js';
import { db } from '../../db/client.js';
import { NotFoundError } from '../../domain/errors.js';
import type { Game, GameStatus, ScheduleState, Team } from '../../domain/types.js';
import { withTransaction, type Executor } from '../../repositories/executor.js';
import {
  gameRepository,
  scoreRepository,
  seasonRepository,
  teamRepository,
} from '../../repositories/index.js';
import { asyncHandler, param } from './helpers.js';

/** One Game of a Season for the management views. */
export interface GameSummary {
  id: string;
  /** ISO date-time string. */
  date: string;
  startTime: string | null;
  durationMinutes: number | null;
  venue: string | null;
  status: GameStatus;
  scheduleState: ScheduleState;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
  playoffRoundId: string | null;
  seriesId: string | null;
  /** From the recorded Score when the Game is completed; otherwise null. */
  homeScore: number | null;
  awayScore: number | null;
}

/** A single Game's full record. Same shape as the list row for now. */
export type GameDetail = GameSummary;

/**
 * Total order for management Game rows: date asc, then start time asc (a null
 * start time sorts first so timeless draft Games order deterministically),
 * then id so the ordering is stable and total.
 */
function compareGames(a: Game, b: Game): number {
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

/** Project a Game plus its Team names and optional Score onto a wire row. */
function toSummary(
  game: Game,
  names: Map<string, string>,
  score: { homeScore: number; awayScore: number } | null,
): GameSummary {
  return {
    id: game.id,
    date: game.date.toISOString(),
    startTime: game.startTime,
    durationMinutes: game.durationMinutes,
    venue: game.venue,
    status: game.status,
    scheduleState: game.scheduleState,
    homeTeamId: game.homeTeamId,
    homeTeamName: names.get(game.homeTeamId) ?? '',
    awayTeamId: game.awayTeamId,
    awayTeamName: names.get(game.awayTeamId) ?? '',
    playoffRoundId: game.playoffRoundId,
    seriesId: game.seriesId,
    homeScore: score ? score.homeScore : null,
    awayScore: score ? score.awayScore : null,
  };
}

/** Build a Team-id -> name lookup from a Season's Teams. */
function teamNameMap(teams: Team[]): Map<string, string> {
  return new Map(teams.map((t) => [t.id, t.name]));
}

/** Build the authenticated management Game-read router (Administrator-only). */
export function createGamesReadRouter(): Router {
  const router = Router();

  router.get(
    '/seasons/:seasonId/games',
    authenticate(),
    authorizeRoleRequest(['Administrator']),
    asyncHandler(async (req, res) => {
      const seasonId = param(req.params.seasonId);
      const payload = await withTransaction(db, async (tx: Executor) => {
        const season = await seasonRepository.findById(seasonId, tx);
        if (!season) {
          throw new NotFoundError('The specified Season does not exist.', { seasonId });
        }
        const [teams, games] = await Promise.all([
          teamRepository.listBySeason(seasonId, tx),
          gameRepository.listBySeason(seasonId, tx),
        ]);
        const names = teamNameMap(teams);
        const ordered = [...games].sort(compareGames);
        const rows: GameSummary[] = [];
        for (const game of ordered) {
          const score =
            game.status === 'completed'
              ? await scoreRepository.findByGame(game.id, tx)
              : null;
          rows.push(toSummary(game, names, score));
        }
        return rows;
      });
      res.json(payload);
    }),
  );

  router.get(
    '/games/:gameId',
    authenticate(),
    authorizeRoleRequest(['Administrator']),
    asyncHandler(async (req, res) => {
      const gameId = param(req.params.gameId);
      const payload = await withTransaction(db, async (tx: Executor) => {
        const game = await gameRepository.findById(gameId, tx);
        if (!game) {
          throw new NotFoundError('The specified Game does not exist.', { gameId });
        }
        const [home, away, score] = await Promise.all([
          teamRepository.findById(game.homeTeamId, tx),
          teamRepository.findById(game.awayTeamId, tx),
          scoreRepository.findByGame(game.id, tx),
        ]);
        const names = new Map<string, string>();
        if (home) names.set(home.id, home.name);
        if (away) names.set(away.id, away.name);
        const effectiveScore = game.status === 'completed' ? score : null;
        return toSummary(game, names, effectiveScore) as GameDetail;
      });
      res.json(payload);
    }),
  );

  return router;
}