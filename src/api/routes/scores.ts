/**
 * Score recording and correction endpoints (Requirement 6).
 *
 * Mutating REST routes over a {@link ScoringService} wired to the
 * {@link StandingsService} recompute so that recording or correcting a Score
 * refreshes the Season's Standings (Req 6.3, 6.4). Scoring is an
 * Administrator-only, Season-scoped action, so both routes are guarded by the
 * `admin` resource.
 *
 *   - POST /games/:gameId/score          record the initial Score and mark the
 *                                        Game completed (Req 6.1).
 *   - POST /games/:gameId/score/correct  correct the Score of a completed Game
 *                                        (Req 6.4).
 *
 * The recompute callback is supplied by {@link createScoringService}'s
 * dependency injection: it delegates to the StandingsService so the two
 * services stay decoupled. Because an open Season's Standings are always
 * computed live from the current Games and Scores, the refresh is a read that
 * confirms the Season's Standings reflect the just-written Score; a closed
 * Season rejects Score changes upstream. The service enforces value bounds and
 * the completed/not-completed rules. A successful record or correction returns
 * 200 with the stored Score.
 *
 * _Requirements: 6.1_
 */
import { Router } from 'express';
import { authenticate, authorizeRequest, type ResourceResolver } from '../middleware/auth.js';
import { db } from '../../db/client.js';
import { createScoringService, type RecomputeStandings } from '../../services/scoringService.js';
import { StandingsService } from '../../services/standingsService.js';
import { asyncHandler, param, readBody, readNumber } from './helpers.js';

/** Administrator-only resource for Season-scoped scoring. */
const adminResource: ResourceResolver = () => ({ kind: 'admin' });

/** Build the scoring router with the ScoringService→StandingsService wiring. */
export function createScoresRouter(): Router {
  const router = Router();

  // Wire the recompute callback to the StandingsService (Req 6.3, 6.4). An open
  // Season's Standings are computed live, so refreshing recomputes the ranking
  // that reflects the newly written Score.
  const standingsService = new StandingsService(db);
  const recompute: RecomputeStandings = async (seasonId) => {
    await standingsService.refreshStandings(seasonId);
  };
  const scoringService = createScoringService(recompute);

  router.post(
    '/:gameId/score',
    authenticate(),
    authorizeRequest('create', adminResource),
    asyncHandler(async (req, res) => {
      const body = readBody(req);
      const score = await scoringService.recordScore(param(req.params.gameId), {
        homeScore: readNumber(body, 'homeScore'),
        awayScore: readNumber(body, 'awayScore'),
      });
      res.status(200).json(score);
    }),
  );

  router.post(
    '/:gameId/score/correct',
    authenticate(),
    authorizeRequest('update', adminResource),
    asyncHandler(async (req, res) => {
      const body = readBody(req);
      const score = await scoringService.correctScore(param(req.params.gameId), {
        homeScore: readNumber(body, 'homeScore'),
        awayScore: readNumber(body, 'awayScore'),
      });
      res.status(200).json(score);
    }),
  );

  return router;
}
