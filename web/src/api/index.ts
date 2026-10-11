/**
 * Public entry point for the API client.
 *
 * Re-exports the transport primitive ({@link request}, {@link ApiError}), the
 * grouped endpoint functions, and every wire type so consumers import from a
 * single `../api` path.
 */
export { ApiError, request } from './client.js';
export {
  authApi,
  publicApi,
  leaguesApi,
  seasonsApi,
  playoffApi,
  teamsApi,
  playersApi,
  assignmentsApi,
  batchApi,
} from './endpoints.js';
export type * from './types.js';
