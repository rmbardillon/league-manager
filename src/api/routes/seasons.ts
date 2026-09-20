/**
 * Season and Tournament management endpoints (Requirement 9).
 *
 * Mutating REST routes over the {@link SeasonTournamentService} plus the
 * Playoff_Round creation that has no dedicated service method (it is a thin
 * insert delegated to the repository). Season/Tournament administration is
 * League/Season-scoped and therefore Administrator-only; every route is guarded
 * by the `admin` resource.
 *
 *   - POST /seasons                        create a Season in a League (Req 9.1).
 *   - POST /seasons/:seasonId/tournaments   create a Tournament (Req 9.4).
 *   - POST /seasons/:seasonId/playoff-rounds create a Playoff_Round (Req 9.9).
 *   - POST /seasons/:seasonId/playoff-games  create a manual playoff Game
 *                                            (Req 9.7); rejected in a closed
 *                                            Season (Req 9.13).
 *   - POST /playoff-rounds/:roundId/series   create a best-of-N Series (Req 9.10).
 *   - POST /seasons/:seasonId/close          close the Season, recording its
 *                                            final Standings snapshot (Req 10.5).
 *
 * The service enforces name/date/format/best-of-N/classification rules. On
 * close, the current Standings are computed first and passed in as the snapshot.
 * A create returns 201; a close returns 200.
 *
 * _Requirements: 9.1_
 */
import { Router } from 'express';
import { authenticate, authorizeRequest, type ResourceResolver } from '../middleware/auth.js';
import { db } from '../../db/client.js';
import { ValidationError } from '../../domain/errors.js';
import { PlayoffRoundTypes, type PlayoffRoundType, type TournamentFormat } from '../../domain/types.js';
import { SeasonTournamentService } from '../../services/seasonTournamentService.js';
import { StandingsService } from '../../services/standingsService.js';
import { playoffRoundRepository } from '../../repositories/index.js';
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

/** Administrator-only resource for League/Season administration. */
const adminResource: ResourceResolver = () => ({ kind: 'admin' });

/** Build the Season/Tournament management router. */
export function createSeasonsRouter(): Router {
  const router = Router();
  const service = new SeasonTournamentService(db);
  const standingsService = new StandingsService(db);

  router.post(
    '/',
    authenticate(),
    authorizeRequest('create', adminResource),
    asyncHandler(async (req, res) => {
      const body = readBody(req);
      const season = await service.createSeason({
        leagueId: readString(body, 'leagueId'),
        name: readString(body, 'name'),
        startDate: readDate(body, 'startDate'),
        endDate: readDate(body, 'endDate'),
      });
      res.status(201).json(season);
    }),
  );

  router.post(
    '/:seasonId/tournaments',
    authenticate(),
    authorizeRequest('create', adminResource),
    asyncHandler(async (req, res) => {
      const body = readBody(req);
      const tournament = await service.createTournament({
        seasonId: param(req.params.seasonId),
        format: readString(body, 'format') as TournamentFormat,
        roundRobinKind: readOptionalString(body, 'roundRobinKind') as
          | 'single'
          | 'double'
          | undefined,
      });
      res.status(201).json(tournament);
    }),
  );

  router.post(
    '/:seasonId/playoff-rounds',
    authenticate(),
    authorizeRequest('create', adminResource),
    asyncHandler(async (req, res) => {
      const body = readBody(req);
      const type = readString(body, 'type');
      if (!(PlayoffRoundTypes as readonly string[]).includes(type)) {
        throw new ValidationError(
          'The Playoff_Round type must be Quarterfinals, Semifinals, or Finals.',
          { field: 'type' },
        );
      }
      const round = await playoffRoundRepository.create(
        { seasonId: param(req.params.seasonId), type: type as PlayoffRoundType },
        db,
      );
      res.status(201).json(round);
    }),
  );

  router.post(
    '/:seasonId/playoff-games',
    authenticate(),
    authorizeRequest('create', adminResource),
    asyncHandler(async (req, res) => {
      const body = readBody(req);
      const game = await service.createPlayoffGame({
        seasonId: param(req.params.seasonId),
        homeTeamId: readString(body, 'homeTeamId'),
        awayTeamId: readString(body, 'awayTeamId'),
        date: readDate(body, 'date'),
        startTime: readOptionalString(body, 'startTime') ?? null,
        durationMinutes: readOptionalNumber(body, 'durationMinutes') ?? null,
        venue: readOptionalString(body, 'venue') ?? null,
        playoffRoundId: readString(body, 'playoffRoundId'),
        seriesId: readOptionalString(body, 'seriesId') ?? null,
      });
      res.status(201).json(game);
    }),
  );

  router.post(
    '/:seasonId/close',
    authenticate(),
    authorizeRequest('update', adminResource),
    asyncHandler(async (req, res) => {
      const seasonId = param(req.params.seasonId);
      // Compute the current Standings first and persist them as the Season's
      // final snapshot on close (Req 10.5).
      const finalStandings = await standingsService.computeStandings(seasonId);
      const season = await service.closeSeason(seasonId, finalStandings);
      res.status(200).json(season);
    }),
  );

  return router;
}

/** Build a small router exposing Series creation under a Playoff_Round. */
export function createSeriesRouter(): Router {
  const router = Router();
  const service = new SeasonTournamentService(db);

  router.post(
    '/:roundId/series',
    authenticate(),
    authorizeRequest('create', adminResource),
    asyncHandler(async (req, res) => {
      const body = readBody(req);
      const created = await service.createSeries({
        playoffRoundId: param(req.params.roundId),
        teamAId: readString(body, 'teamAId'),
        teamBId: readString(body, 'teamBId'),
        bestOf: readNumber(body, 'bestOf'),
      });
      res.status(201).json(created);
    }),
  );

  return router;
}
