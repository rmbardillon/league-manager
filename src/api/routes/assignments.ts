/**
 * Team-scoped roster-assignment endpoints (Requirements 2, 3, 4.1).
 *
 * Mutating REST routes over the assignment and roster-read methods of
 * {@link playerService}. Unlike the master Player routes, the owning Team id is
 * carried in the **path** for every route here, so the authorization scope is
 * known up front: each route guards with
 * `authorizeRequest(action, req => ({ kind: 'team', teamId }))` — an
 * Administrator may act on any Team and a Team_Manager only on a Team in their
 * managed set (Req 2.2, 2.3, 9.2). The service re-checks the same team-scoped
 * decision, so an unauthorized caller never learns whether the Team, Player, or
 * assignment exists (non-disclosure).
 *
 *   - POST   /teams/:teamId/assignments            assign a Player to the Team
 *                                                  with a jersey number
 *                                                  (Req 2.1, 3.1, 3.2).
 *   - PATCH  /teams/:teamId/assignments/:playerId  change an assignment's
 *                                                  jersey number (Req 2.7, 3.1).
 *   - DELETE /teams/:teamId/assignments/:playerId  remove the Player's
 *                                                  assignment on the Team
 *                                                  (Req 2.5, 2.6).
 *   - GET    /teams/:teamId/roster                 read the Team roster
 *                                                  (Req 4.1, 4.2).
 *
 * Each handler performs only shallow request parsing (path params and the JSON
 * body) and delegates every business rule — field bounds, jersey uniqueness,
 * one-per-season, existence — to the service. Typed {@link DomainError}s thrown
 * by the service are mapped to HTTP status by the central `errorHandler`
 * (400/403/404/409). A create returns 201; an update and the roster read return
 * 200; an unassign returns 204.
 *
 * _Requirements: 2, 3, 4.1_
 */
import { Router } from 'express';
import { authenticate, authorizeRequest, type ResourceResolver } from '../middleware/auth.js';
import { db } from '../../db/client.js';
import { AuthenticationError } from '../../domain/errors.js';
import { playerService } from '../../services/playerService.js';
import { asyncHandler, param, readBody, readNumber, readString } from './helpers.js';

/** Scope an assignment operation to the Team named in the request path. */
const teamResource: ResourceResolver = (req) => ({
  kind: 'team',
  teamId: param(req.params.teamId),
});

/** Build the team-scoped assignment router. */
export function createAssignmentsRouter(): Router {
  const router = Router();

  router.post(
    '/:teamId/assignments',
    authenticate(),
    authorizeRequest('create', teamResource),
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw new AuthenticationError('Authentication is required.');
      const body = readBody(req);
      const assignment = await playerService.assignPlayer(
        auth.user,
        {
          teamId: param(req.params.teamId),
          playerId: readString(body, 'playerId'),
          jerseyNumber: readNumber(body, 'jerseyNumber'),
        },
        db,
      );
      res.status(201).json(assignment);
    }),
  );

  router.patch(
    '/:teamId/assignments/:playerId',
    authenticate(),
    authorizeRequest('update', teamResource),
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw new AuthenticationError('Authentication is required.');
      const body = readBody(req);
      const assignment = await playerService.updateAssignmentJersey(
        auth.user,
        {
          teamId: param(req.params.teamId),
          playerId: param(req.params.playerId),
          jerseyNumber: readNumber(body, 'jerseyNumber'),
        },
        db,
      );
      res.status(200).json(assignment);
    }),
  );

  router.delete(
    '/:teamId/assignments/:playerId',
    authenticate(),
    authorizeRequest('delete', teamResource),
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw new AuthenticationError('Authentication is required.');
      await playerService.unassignPlayer(
        auth.user,
        {
          teamId: param(req.params.teamId),
          playerId: param(req.params.playerId),
        },
        db,
      );
      res.status(204).end();
    }),
  );

  router.get(
    '/:teamId/roster',
    authenticate(),
    authorizeRequest('update', teamResource),
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw new AuthenticationError('Authentication is required.');
      const roster = await playerService.getTeamRoster(param(req.params.teamId), db);
      res.status(200).json(roster);
    }),
  );

  return router;
}
