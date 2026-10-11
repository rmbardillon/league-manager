/**
 * Statistics recording endpoints (Requirement 8).
 *
 * Mutating REST routes over the {@link StatisticsService}. Recording a Statistic
 * is an Administrator-only, Season-scoped action, guarded by the `admin`
 * resource.
 *
 *   - POST /statistics   record a Statistic value for a Player in a Game
 *                        (Req 8.2).
 *
 * The `type` field is passed through as-is; the service delegates to the pure
 * validator, which rejects any value outside the six supported Statistic_Type
 * values (Req 8.4), an out-of-range value (Req 8.3), or an ineligible Player
 * (Req 8.5). A successful record returns 201 with the stored Statistic.
 *
 * _Requirements: 8.2_
 */
import { Router } from 'express';
import {
  authenticate,
  authorizeRequest,
  authorizeRoleRequest,
  type ResourceResolver,
} from '../middleware/auth.js';
import { db } from '../../db/client.js';
import { StatisticsService } from '../../services/statisticsService.js';
import type { StatisticType } from '../../domain/types.js';
import { asyncHandler, param, readBody, readNumber, readString } from './helpers.js';

/** Administrator-only resource for Season-scoped Statistics. */
const adminResource: ResourceResolver = () => ({ kind: 'admin' });

/** One per-type total in a season stat line. */
interface StatTotal {
  type: StatisticType;
  total: number;
}

/** Per-Player or per-Team season statistic totals. */
interface SeasonStatsPayload {
  seasonId: string;
  subjectId: string;
  totals: StatTotal[];
}

/** Convert a StatisticTotals record into a stable, ordered wire array. */
function toTotals(record: Record<StatisticType, number>): StatTotal[] {
  const order: StatisticType[] = [
    'Points',
    'Assists',
    'Rebounds',
    'Steals',
    'Blocks',
    'Three_Pointers_Made',
  ];
  return order.map((type) => ({ type, total: record[type] ?? 0 }));
}
/** Build the Statistics router. */
export function createStatisticsRouter(): Router {
  const router = Router();
  const statisticsService = new StatisticsService(db);

  router.post(
    '/',
    authenticate(),
    authorizeRequest('create', adminResource),
    asyncHandler(async (req, res) => {
      const body = readBody(req);
      const statistic = await statisticsService.recordStatistic({
        playerId: readString(body, 'playerId'),
        gameId: readString(body, 'gameId'),
        // The service's pure validator rejects an unsupported type (Req 8.4),
        // so the value is passed through unchecked at the transport layer.
        type: readString(body, 'type') as StatisticType,
        value: readNumber(body, 'value'),
      });
      res.status(201).json(statistic);
    }),
  );

  router.get(
    '/seasons/:seasonId/players/:playerId',
    authenticate(),
    authorizeRoleRequest(['Administrator']),
    asyncHandler(async (req, res) => {
      const seasonId = param(req.params.seasonId);
      const playerId = param(req.params.playerId);
      const totals = await statisticsService.getPlayerSeasonStats(seasonId, playerId);
      const payload: SeasonStatsPayload = {
        seasonId,
        subjectId: playerId,
        totals: toTotals(totals),
      };
      res.json(payload);
    }),
  );

  router.get(
    '/seasons/:seasonId/teams/:teamId',
    authenticate(),
    authorizeRoleRequest(['Administrator']),
    asyncHandler(async (req, res) => {
      const seasonId = param(req.params.seasonId);
      const teamId = param(req.params.teamId);
      const totals = await statisticsService.getTeamSeasonStats(seasonId, teamId);
      const payload: SeasonStatsPayload = {
        seasonId,
        subjectId: teamId,
        totals: toTotals(totals),
      };
      res.json(payload);
    }),
  );

  return router;
}
