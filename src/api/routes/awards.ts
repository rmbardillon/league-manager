/**
 * Awards computation and publication endpoints (Requirement 13).
 *
 * Mutating REST routes over the {@link AwardsService}. Computing and publishing
 * Awards are Administrator-only, Season/Tournament-scoped actions; both routes
 * are guarded by the `admin` resource. Newly computed Awards are stored
 * unpublished and stay hidden from Viewers until published (Req 13.13); the
 * public read of published Awards lives on the public browsing routes.
 *
 *   - POST /scopes/:scopeId/awards/compute   compute and persist Awards as
 *                                            unpublished (Req 13.13–13.16).
 *   - POST /scopes/:scopeId/awards/publish   publish the scope's Awards so
 *                                            Viewers can see them (Req 13.13).
 *
 * The service delegates the selection logic to the pure domain functions and
 * surfaces the no-Statistics (Req 13.16) and no-Finals (Req 13.12) indications
 * in the compute result rather than failing. Both routes return 200 with the
 * result payload.
 *
 * _Requirements: 13.13_
 */
import { Router } from 'express';
import { authenticate, authorizeRequest, type ResourceResolver } from '../middleware/auth.js';
import { db } from '../../db/client.js';
import { AwardsService } from '../../services/awardsService.js';
import { asyncHandler, param } from './helpers.js';

/** Administrator-only resource for Awards administration. */
const adminResource: ResourceResolver = () => ({ kind: 'admin' });

/** Build the Awards router. */
export function createAwardsRouter(): Router {
  const router = Router();
  const service = new AwardsService(db);

  router.post(
    '/:scopeId/awards/compute',
    authenticate(),
    authorizeRequest('create', adminResource),
    asyncHandler(async (req, res) => {
      const result = await service.computeAwards(param(req.params.scopeId));
      res.status(200).json(result);
    }),
  );

  router.post(
    '/:scopeId/awards/publish',
    authenticate(),
    authorizeRequest('update', adminResource),
    asyncHandler(async (req, res) => {
      const awards = await service.publishAwards(param(req.params.scopeId));
      res.status(200).json({ awards });
    }),
  );

  return router;
}
