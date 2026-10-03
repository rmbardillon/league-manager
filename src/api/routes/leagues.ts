/**
 * Authenticated League/Season enumeration endpoints (Requirement 1).
 *
 * The management UI needs name-labeled, cascading selectors instead of free-text
 * UUID entry; the first step is an authenticated enumeration of Leagues and, for
 * a chosen League, its Seasons. These reads carry no business rule beyond
 * "authenticated + Administrator role" (plus a League existence guard), so each
 * route composes `authenticate()` + `authorizeRoleRequest(['Administrator'])`
 * and calls the repositories directly — the same shape `public.ts` uses for its
 * read endpoints, but guarded.
 *
 * This enumeration is intentionally distinct from the public, unauthenticated
 * `GET /public/seasons` browsing path (Req 1.8): a dedicated `/leagues` router
 * keeps the Administrator-only Leagues/Seasons listing separate from the Viewer
 * browsing surface.
 *
 *   - GET /leagues (Req 1.1, 1.5)
 *       All Leagues as `LeagueSummary[]` (`{ id, name }`). An empty set yields
 *       `[]`, never an error.
 *
 *   - GET /leagues/:leagueId/seasons (Req 1.2, 1.3, 1.4)
 *       The Seasons of a League as `SeasonSummary[]` with ISO date strings. A
 *       request for an unknown League yields a 404 (Req 1.3); a League with no
 *       Seasons yields `[]` (Req 1.4). The existence guard and the listing run
 *       inside one `withTransaction` snapshot so the response reflects a single
 *       consistent view.
 *
 * _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.8_
 */
import { Router } from 'express';
import { authenticate, authorizeRoleRequest } from '../middleware/auth.js';
import { db } from '../../db/client.js';
import { NotFoundError } from '../../domain/errors.js';
import { leagueRepository, seasonRepository } from '../../repositories/index.js';
import { withTransaction } from '../../repositories/executor.js';
import { asyncHandler, param } from './helpers.js';

/** A League for selector display (Req 1.1). */
export interface LeagueSummary {
  id: string;
  name: string;
}

/** A Season for selector display and the Season management view (Req 1.2). */
export interface SeasonSummary {
  id: string;
  name: string;
  /** ISO date-time string. */
  startDate: string;
  /** ISO date-time string. */
  endDate: string;
  closed: boolean;
}

/**
 * Build the authenticated Leagues/Seasons enumeration router. Mounted at
 * `/leagues` by the transport layer (wired in a later task); every route is
 * Administrator-only.
 */
export function createLeaguesRouter(): Router {
  const router = Router();

  router.get(
    '/',
    authenticate(),
    authorizeRoleRequest(['Administrator']),
    asyncHandler(async (_req, res) => {
      const leagues = await leagueRepository.list(db);
      const payload: LeagueSummary[] = leagues.map((league) => ({
        id: league.id,
        name: league.name,
      }));
      res.json(payload);
    }),
  );

  router.get(
    '/:leagueId/seasons',
    authenticate(),
    authorizeRoleRequest(['Administrator']),
    asyncHandler(async (req, res) => {
      const leagueId = param(req.params.leagueId);
      const payload = await withTransaction(db, async (tx) => {
        // Distinguish an unknown League (404) from a known League with no
        // Seasons (empty list) — Req 1.3 vs 1.4.
        const league = await leagueRepository.findById(leagueId, tx);
        if (!league) {
          throw new NotFoundError('The specified League does not exist.', { leagueId });
        }
        const seasons = await seasonRepository.listByLeague(leagueId, tx);
        return seasons.map(
          (season): SeasonSummary => ({
            id: season.id,
            name: season.name,
            startDate: season.startDate.toISOString(),
            endDate: season.endDate.toISOString(),
            closed: season.closed,
          }),
        );
      });
      res.json(payload);
    }),
  );

  return router;
}
