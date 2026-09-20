/**
 * Roster (Player) management endpoints (Requirement 4).
 *
 * Mutating REST routes over {@link playerService}. Every route requires an
 * authenticated session and is team-scoped: an Administrator or the managing
 * Team_Manager may act (Req 4.4). Because {@link playerService} performs the
 * team-scoped authorization itself — deriving the owning Team from the target
 * Player for update/remove so the caller never learns whether an unauthorized
 * Player exists — this layer passes the authenticated principal and the `db`
 * executor straight through:
 *
 *   - POST   /players             add a Player. The owning Team id is in the
 *                                 body, so an authorization guard can be scoped
 *                                 up front.
 *   - PATCH  /players/:playerId   update a Player's name and/or jersey number.
 *   - DELETE /players/:playerId   remove a Player.
 *
 * For update/remove the owning Team is only known after loading the Player, so
 * the route relies on the service's internal authorization rather than a
 * request-time guard. The service enforces all field bounds and jersey
 * uniqueness. A create returns 201; an update returns 200; a remove returns 204.
 *
 * _Requirements: 4.1_
 */
import { Router } from 'express';
import { authenticate, authorizeRequest, type ResourceResolver } from '../middleware/auth.js';
import { db } from '../../db/client.js';
import { AuthenticationError } from '../../domain/errors.js';
import { playerService } from '../../services/playerService.js';
import {
  asyncHandler,
  param,
  readBody,
  readNumber,
  readOptionalNumber,
  readOptionalString,
  readString,
} from './helpers.js';

/** Scope Player creation to the owning Team named in the request body. */
const addPlayerResource: ResourceResolver = (req) => {
  const body = req.body as Record<string, unknown> | undefined;
  const teamId = typeof body?.teamId === 'string' ? body.teamId : '';
  return { kind: 'team', teamId };
};

/** Build the roster management router. */
export function createPlayersRouter(): Router {
  const router = Router();

  router.post(
    '/',
    authenticate(),
    authorizeRequest('create', addPlayerResource),
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw new AuthenticationError('Authentication is required.');
      const body = readBody(req);
      const player = await playerService.addPlayer(
        auth.user,
        {
          teamId: readString(body, 'teamId'),
          name: readString(body, 'name'),
          jerseyNumber: readNumber(body, 'jerseyNumber'),
        },
        db,
      );
      res.status(201).json(player);
    }),
  );

  router.patch(
    '/:playerId',
    authenticate(),
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw new AuthenticationError('Authentication is required.');
      const body = readBody(req);
      const player = await playerService.updatePlayer(
        auth.user,
        {
          playerId: param(req.params.playerId),
          name: readOptionalString(body, 'name'),
          jerseyNumber: readOptionalNumber(body, 'jerseyNumber'),
        },
        db,
      );
      res.status(200).json(player);
    }),
  );

  router.delete(
    '/:playerId',
    authenticate(),
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw new AuthenticationError('Authentication is required.');
      await playerService.removePlayer(
        auth.user,
        { playerId: param(req.params.playerId) },
        db,
      );
      res.status(204).end();
    }),
  );

  return router;
}
