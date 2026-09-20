/**
 * Manual Game scheduling endpoints (Requirement 5).
 *
 * Mutating REST routes over {@link schedulingService}. Scheduling spans two
 * Teams within a Season, so it is an Administrator-only, Season-scoped action
 * (a Team_Manager scoped to a single Team cannot own a two-Team Game); every
 * route is guarded by the `admin` resource.
 *
 *   - POST  /games              create a manual Game (Req 5.1).
 *   - PATCH /games/:gameId       reschedule a non-cancelled Game (Req 5.6).
 *   - POST  /games/:gameId/cancel cancel a Game, retaining the record (Req 5.8).
 *
 * The service enforces the required-field, distinct-Team, duration, future-date,
 * and Venue-conflict rules; this layer only parses and serializes. A create
 * returns 201; a reschedule and a cancel return 200.
 *
 * _Requirements: 5.1_
 */
import { Router } from 'express';
import { authenticate, authorizeRequest, type ResourceResolver } from '../middleware/auth.js';
import { schedulingService } from '../../services/schedulingService.js';
import {
  asyncHandler,
  param,
  readBody,
  readDate,
  readNumber,
  readOptionalNumber,
  readOptionalString,
  readString,
} from './helpers.js';

/** Administrator-only resource for Season-scoped scheduling. */
const adminResource: ResourceResolver = () => ({ kind: 'admin' });

/** Build the manual scheduling router. */
export function createGamesRouter(): Router {
  const router = Router();

  router.post(
    '/',
    authenticate(),
    authorizeRequest('create', adminResource),
    asyncHandler(async (req, res) => {
      const body = readBody(req);
      const game = await schedulingService.createGame({
        seasonId: readString(body, 'seasonId'),
        homeTeamId: readString(body, 'homeTeamId'),
        awayTeamId: readString(body, 'awayTeamId'),
        date: readDate(body, 'date'),
        startTime: readString(body, 'startTime'),
        durationMinutes: readNumber(body, 'durationMinutes'),
        venue: readString(body, 'venue'),
      });
      res.status(201).json(game);
    }),
  );

  router.patch(
    '/:gameId',
    authenticate(),
    authorizeRequest('update', adminResource),
    asyncHandler(async (req, res) => {
      const body = readBody(req);
      const game = await schedulingService.rescheduleGame(param(req.params.gameId), {
        date: readDate(body, 'date'),
        startTime: readString(body, 'startTime'),
        durationMinutes: readOptionalNumber(body, 'durationMinutes'),
        venue: readOptionalString(body, 'venue'),
      });
      res.status(200).json(game);
    }),
  );

  router.post(
    '/:gameId/cancel',
    authenticate(),
    authorizeRequest('update', adminResource),
    asyncHandler(async (req, res) => {
      const game = await schedulingService.cancelGame(param(req.params.gameId));
      res.status(200).json(game);
    }),
  );

  return router;
}
