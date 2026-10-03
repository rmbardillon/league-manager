/**
 * Master Player management endpoints (Requirement 1, plus the player-history
 * read of Requirement 4.3).
 *
 * These REST routes sit over the master-Player methods of {@link playerService}
 * — the person model `{ id, name }`, decoupled from any Team or jersey. Unlike
 * the former team-scoped roster routes, every operation here is
 * **Administrator-scoped**: it is not tied to a Team, so the request-time guard
 * resolves the resource as `{ kind: 'admin' }` and the pure `authorize`
 * decision admits only an Administrator (the service re-checks the same way, so
 * the guard and the service agree). The authorization `action` passed to
 * {@link authorizeRequest} mirrors the action the service asserts: `create` for
 * the create route, `delete` for removal, and `update` for the read/rename
 * routes — the pure `authorize` treats every governed action uniformly for the
 * `admin` resource, so a read reuses `update` consistently with how the service
 * guards `getPlayer`/`listPlayers`.
 *
 *   - POST   /players                  create a master Player (`{name}` → 201).
 *   - GET    /players                  list every master Player.
 *   - GET    /players/:playerId        fetch one master Player (404 if absent).
 *   - PATCH  /players/:playerId        rename a master Player (400/404).
 *   - DELETE /players/:playerId        remove a master Player (404; 409 when
 *                                      the Player is still assigned to a Team).
 *   - GET    /players/:playerId/history  the Player's assignment history
 *                                      (Team/Season/jersey per entry, Req 4.3).
 *
 * Each handler reads the authenticated principal from `req.auth` (a missing
 * context is a 401 {@link AuthenticationError}) and delegates to the service.
 * The create/read/rename/remove methods take `(auth.user, {...}, db)`; the
 * `history` read is a pure `(playerId, db)` lookup whose exposure is decided by
 * the Administrator route guard rather than a service-side gate. All
 * business rules (name bounds, existence, deletion gating) live in the service;
 * this layer never catches, so a thrown {@link DomainError} flows to the
 * central `errorHandler` for the status mapping (201/200/204/400/404/409).
 *
 * _Requirements: 1.1, 1.4, 1.5, 1.7, 1.8, 1.9, 4.3, 9.1_
 */
import { Router } from 'express';
import { authenticate, authorizeRequest } from '../middleware/auth.js';
import { db } from '../../db/client.js';
import { AuthenticationError } from '../../domain/errors.js';
import { playerService } from '../../services/playerService.js';
import { asyncHandler, param, readBody, readString } from './helpers.js';

/** Resolve every master-Player route to the Administrator-only resource. */
const adminResource = () => ({ kind: 'admin' }) as const;

/** Build the master-Player management router. */
export function createPlayersRouter(): Router {
  const router = Router();

  router.post(
    '/',
    authenticate(),
    authorizeRequest('create', adminResource),
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw new AuthenticationError('Authentication is required.');
      const body = readBody(req);
      const player = await playerService.createPlayer(
        auth.user,
        { name: readString(body, 'name') },
        db,
      );
      res.status(201).json(player);
    }),
  );

  router.get(
    '/',
    authenticate(),
    authorizeRequest('update', adminResource),
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw new AuthenticationError('Authentication is required.');
      const players = await playerService.listPlayers(auth.user, db);
      res.status(200).json(players);
    }),
  );

  router.get(
    '/:playerId',
    authenticate(),
    authorizeRequest('update', adminResource),
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw new AuthenticationError('Authentication is required.');
      const player = await playerService.getPlayer(
        auth.user,
        { playerId: param(req.params.playerId) },
        db,
      );
      res.status(200).json(player);
    }),
  );

  router.patch(
    '/:playerId',
    authenticate(),
    authorizeRequest('update', adminResource),
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw new AuthenticationError('Authentication is required.');
      const body = readBody(req);
      const player = await playerService.updatePlayer(
        auth.user,
        {
          playerId: param(req.params.playerId),
          name: readString(body, 'name'),
        },
        db,
      );
      res.status(200).json(player);
    }),
  );

  router.delete(
    '/:playerId',
    authenticate(),
    authorizeRequest('delete', adminResource),
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

  router.get(
    '/:playerId/history',
    authenticate(),
    authorizeRequest('update', adminResource),
    asyncHandler(async (req, res) => {
      const auth = req.auth;
      if (!auth) throw new AuthenticationError('Authentication is required.');
      // `getPlayerHistory` is a pure read: per the design, exposure is decided
      // by the route (the Administrator guard above), so the service takes
      // `(playerId, ex)` and applies no authorization gate of its own.
      const history = await playerService.getPlayerHistory(
        param(req.params.playerId),
        db,
      );
      res.status(200).json(history);
    }),
  );

  return router;
}
