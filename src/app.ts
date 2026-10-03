/**
 * Express application factory.
 *
 * Wires the transport layer together: JSON body parsing, a health endpoint, the
 * unauthenticated public browsing routes (Requirement 10), and the auth-guarded
 * mutating routers for every management use case (Requirements 3, 4, 5, 6, 8, 9,
 * 11, 12, 13). The central {@link errorHandler} is registered LAST so it maps
 * every {@link DomainError} thrown by a controller or middleware onto the
 * correct HTTP status.
 *
 * Route groups:
 *   - /public                       read-only schedule/results/standings/awards (Req 10, 13.15)
 *   - /auth                         sign-in/out and current-principal (Req 1)
 *   - /leagues                      authenticated League/Season enumeration for
 *                                   the management UI selectors (Req 1.1)
 *   - /teams                        Team management (Req 3) plus team-scoped
 *                                   roster/assignment subpaths — assign/unassign,
 *                                   jersey updates, and roster reads (Req 2, 3, 4.1)
 *   - /players                      master-Player management: CRUD plus
 *                                   player history (Req 1, 4.3)
 *   - /games                        manual scheduling + scoring (Req 5, 6)
 *   - /statistics                   Statistics recording (Req 8)
 *   - /seasons, /playoff-rounds     Season/Tournament/playoff administration (Req 9)
 *   - /seasons/:id/batch-upload     Batch_Upload (Req 11)
 *   - (schedule generation)         automatic scheduling (Req 12)
 *   - /scopes/:id/awards            Awards computation/publication (Req 13)
 */
import express, { type Express, type Request, type Response } from 'express';
import { db } from './db/client.js';
import { errorHandler } from './api/middleware/errorHandler.js';
import { registerPublicRoutes } from './api/routes/public.js';
import { createTeamsRouter } from './api/routes/teams.js';
import { createPlayersRouter } from './api/routes/players.js';
import { createAssignmentsRouter } from './api/routes/assignments.js';
import { createGamesRouter } from './api/routes/games.js';
import { createScoresRouter } from './api/routes/scores.js';
import { createStatisticsRouter } from './api/routes/statistics.js';
import { createSeasonsRouter, createSeriesRouter } from './api/routes/seasons.js';
import { createBatchRouter } from './api/routes/batch.js';
import { createScheduleRouter } from './api/routes/schedule.js';
import { createAwardsRouter } from './api/routes/awards.js';
import { createAuthRouter } from './api/routes/auth.js';
import { createLeaguesRouter } from './api/routes/leagues.js';

export function createApp(): Express {
  const app = express();

  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Unauthenticated public browsing routes (Req 10.6).
  registerPublicRoutes(app, db);

  // Authentication routes: sign-in/out and current-principal (Req 1.1). These
  // manage the session cookie themselves rather than requiring a prior session.
  app.use('/auth', createAuthRouter());

  // Auth-guarded mutating routers. Scoring and automatic scheduling both mount
  // additional routes under /games and /seasons respectively; Express composes
  // the overlapping prefixes without conflict.
  // Two routers share the /teams mount: team CRUD ('/', '/:teamId') and the
  // team-scoped roster/assignment subpaths ('/:teamId/assignments',
  // '/:teamId/assignments/:playerId', '/:teamId/roster'). The path sets do not
  // collide, so Express composes them without conflict.
  // Authenticated League/Season enumeration for the management UI selectors
  // (Req 1.1). Administrator-only; see createLeaguesRouter for the guards.
  app.use('/leagues', createLeaguesRouter());
  app.use('/teams', createTeamsRouter());
  app.use('/teams', createAssignmentsRouter());
  app.use('/players', createPlayersRouter());
  app.use('/games', createGamesRouter());
  app.use('/games', createScoresRouter());
  app.use('/statistics', createStatisticsRouter());
  app.use('/seasons', createSeasonsRouter());
  app.use('/seasons', createBatchRouter());
  app.use('/playoff-rounds', createSeriesRouter());
  app.use('/scopes', createAwardsRouter());
  // Automatic scheduling mounts its own /seasons/... and /games/... subpaths.
  app.use('/', createScheduleRouter());

  // The central error handler MUST be registered last so it maps DomainErrors
  // thrown by any route or middleware to the correct HTTP status.
  app.use(errorHandler);

  return app;
}
