/**
 * Public entry point for the Repository Layer.
 *
 * Thin, data-access-only CRUD repositories for every entity, plus the shared
 * {@link withTransaction} helper enabling single-transaction, all-or-nothing
 * multi-write operations (batch import — Req 11.3; Score + Game completion —
 * Req 6.1; Team deletion gating support — Req 3.7).
 *
 * Every repository method takes an {@link Executor} (the root `db` handle or a
 * transaction handle), so the same call composes standalone or inside a
 * larger transaction.
 *
 * _Requirements: 3.7, 6.1, 11.3_
 */
export * from './executor.js';
export * from './mappers.js';
export { leagueRepository } from './leagueRepository.js';
export { seasonRepository, tournamentRepository } from './seasonRepository.js';
export { teamRepository, playerRepository } from './teamRepository.js';
export {
  gameRepository,
  scoreRepository,
  statisticRepository,
} from './gameRepository.js';
export { playoffRoundRepository, seriesRepository } from './playoffRepository.js';
export { userRepository, sessionRepository } from './userRepository.js';
export { awardRepository } from './awardRepository.js';
