/**
 * Team management endpoints (Requirement 3).
 *
 * Mutating REST routes over {@link teamService}. All routes require an
 * authenticated session; the authorization scope differs per route:
 *
 *   - POST   /teams            create a Team in a Season. Creating a Team is a
 *                              Season-scoped, Administrator-only action (there
 *                              is no owning Team yet to scope a Team_Manager
 *                              to), so it is guarded by the `admin` resource.
 *   - PATCH  /teams/:teamId    rename a Team. Team-scoped: an Administrator or
 *                              the managing Team_Manager may act (Req 2.2).
 *   - DELETE /teams/:teamId    delete a Team with no completed Games. Team-
 *                              scoped like the update.
 *
 * The service enforces every business rule (name bounds, Season existence,
 * case-insensitive uniqueness, completed-Game gating); this layer only parses
 * the request and serializes the response. A create returns 201; an update
 * returns 200; a delete returns 204. All failures propagate to the central
 * error handler.
 *
 * _Requirements: 3.1_
 */
import { Router } from 'express';
import { authenticate, authorizeRequest, type ResourceResolver } from '../middleware/auth.js';
import { teamService } from '../../services/teamService.js';
import { asyncHandler, param, readBody, readString } from './helpers.js';

/** Resolve the team-scoped resource for :teamId routes (Req 2.2). */
const teamResource: ResourceResolver = (req) => ({
  kind: 'team',
  teamId: param(req.params.teamId),
});

/** Administrator-only resource for Season-scoped Team creation. */
const adminResource: ResourceResolver = () => ({ kind: 'admin' });

/** Build the Team management router. */
export function createTeamsRouter(): Router {
  const router = Router();

  router.post(
    '/',
    authenticate(),
    authorizeRequest('create', adminResource),
    asyncHandler(async (req, res) => {
      const body = readBody(req);
      const team = await teamService.createTeam({
        seasonId: readString(body, 'seasonId'),
        name: readString(body, 'name'),
      });
      res.status(201).json(team);
    }),
  );

  router.patch(
    '/:teamId',
    authenticate(),
    authorizeRequest('update', teamResource),
    asyncHandler(async (req, res) => {
      const body = readBody(req);
      const team = await teamService.updateTeam(param(req.params.teamId), {
        name: readString(body, 'name'),
      });
      res.status(200).json(team);
    }),
  );

  router.delete(
    '/:teamId',
    authenticate(),
    authorizeRequest('delete', teamResource),
    asyncHandler(async (req, res) => {
      await teamService.deleteTeam(param(req.params.teamId));
      res.status(204).end();
    }),
  );

  return router;
}
