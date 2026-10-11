/**
 * Automatic schedule generation endpoints (Requirement 12).
 *
 * Mutating REST routes over the {@link AutomaticSchedulingService} for the
 * draft-then-submit workflow. Automatic generation is Administrator-only
 * (Req 12.1); each route is guarded by the `schedule-generation` resource,
 * which the pure authorizer denies for every non-Administrator, and the service
 * re-checks the same rule.
 *
 *   - POST /seasons/:seasonId/schedule/generate    generate a Draft_Schedule
 *                                                  (Req 12.2, 12.15).
 *   - POST /seasons/:seasonId/schedule/regenerate   discard the draft and
 *                                                  regenerate it (Req 12.16).
 *   - POST /games/:gameId/assign                    assign a Venue + start time
 *                                                  to a draft Game (Req 12.11).
 *   - POST /seasons/:seasonId/schedule/submit       submit the draft so it
 *                                                  becomes official/visible
 *                                                  (Req 12.17).
 *
 * The service validates the generation inputs (Req 12.3–12.6) and reports
 * insufficient capacity (Req 12.18). A generate/regenerate returns 201 with the
 * created draft Games; an assign and a submit return 200.
 *
 * _Requirements: 12.2_
 */
import { Router } from 'express';
import { authenticate, authorizeRequest, type ResourceResolver } from '../middleware/auth.js';
import { db } from '../../db/client.js';
import { AuthenticationError, ValidationError } from '../../domain/errors.js';
import type { PlayableDay } from '../../domain/distribute.js';
import { AutomaticSchedulingService } from '../../services/automaticSchedulingService.js';
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

/** Administrator-only resource for automatic schedule generation (Req 12.1). */
const generationResource: ResourceResolver = () => ({ kind: 'schedule-generation' });

/** Parse the `playableDays` field into a string[] of weekday names. */
function readPlayableDays(body: Record<string, unknown>): PlayableDay[] {
  const value = body.playableDays;
  if (!Array.isArray(value) || value.some((d) => typeof d !== 'string')) {
    throw new ValidationError('The field "playableDays" must be an array of day names.', {
      field: 'playableDays',
    });
  }
  // The service validates that the selection is non-empty and the pure domain
  // maps each name to a weekday; unknown names simply place no Games.
  return value as PlayableDay[];
}

/** Parse the `roundRobinKind` field into single/double. */
function readRoundRobinKind(body: Record<string, unknown>): 'single' | 'double' {
  const value = readString(body, 'roundRobinKind');
  if (value !== 'single' && value !== 'double') {
    throw new ValidationError('The field "roundRobinKind" must be "single" or "double".', {
      field: 'roundRobinKind',
    });
  }
  return value;
}

/** Build the automatic scheduling router. */
export function createScheduleRouter(): Router {
  const router = Router();
  const service = new AutomaticSchedulingService(db);

  const runGenerate = (mode: 'generate' | 'regenerate') =>
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw new AuthenticationError('Authentication is required.');
      const body = readBody(req);
      const command = {
        seasonId: param(req.params.seasonId),
        startDate: readDate(body, 'startDate'),
        endDate: readDate(body, 'endDate'),
        playableDays: readPlayableDays(body),
        roundRobinKind: readRoundRobinKind(body),
        gamesPerDay: readNumber(body, 'gamesPerDay'),
      };
      const games =
        mode === 'generate'
          ? await service.generateSchedule(auth.user, command)
          : await service.regenerateSchedule(auth.user, command);
      res.status(201).json({ games });
    });

  router.post(
    '/seasons/:seasonId/schedule/generate',
    authenticate(),
    authorizeRequest('create', generationResource),
    runGenerate('generate'),
  );

  router.post(
    '/seasons/:seasonId/schedule/regenerate',
    authenticate(),
    authorizeRequest('create', generationResource),
    runGenerate('regenerate'),
  );

  router.post(
    '/games/:gameId/assign',
    authenticate(),
    authorizeRequest('update', generationResource),
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw new AuthenticationError('Authentication is required.');
      const body = readBody(req);
      const game = await service.assignVenueAndTime(auth.user, {
        gameId: param(req.params.gameId),
        venue: readString(body, 'venue'),
        startTime: readString(body, 'startTime'),
        durationMinutes: readOptionalNumber(body, 'durationMinutes'),
      });
      res.status(200).json(game);
    }),
  );

  router.patch(
    '/games/:gameId/draft',
    authenticate(),
    authorizeRequest('update', generationResource),
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw new AuthenticationError('Authentication is required.');
      const body = readBody(req);
      const game = await service.editDraftGame(auth.user, {
        gameId: param(req.params.gameId),
        date: body.date === undefined || body.date === null ? undefined : readDate(body, 'date'),
        homeTeamId: readOptionalString(body, 'homeTeamId'),
        awayTeamId: readOptionalString(body, 'awayTeamId'),
      });
      res.status(200).json(game);
    }),
  );

  router.post(
    '/seasons/:seasonId/schedule/submit',
    authenticate(),
    authorizeRequest('update', generationResource),
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw new AuthenticationError('Authentication is required.');
      const games = await service.submitDraftSchedule(auth.user, param(req.params.seasonId));
      res.status(200).json({ games });
    }),
  );

  return router;
}
