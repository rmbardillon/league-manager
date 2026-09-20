/**
 * Pure Series resolution for the SeasonTournamentService playoff logic.
 *
 * A Series is a set of playoff Games between the same two Teams within a
 * Playoff_Round, decided by a best-of-N format. The Team that first wins a
 * majority (strictly more than half) of the N Games wins the Series. This
 * module exposes that rule as a pure, I/O-free function so it can be
 * property-tested in isolation (Property 22) and reused by the service layer.
 *
 * Decision rules (Requirement 9):
 * - Req 9.10 / 9.11: a Series is valid only for a best-of-N of 1, 3, 5, or 7;
 *   any other value is rejected with a validation error and yields no result.
 * - Req 9.12: the winner is the Team that wins more than half of the N Games,
 *   i.e. the first Team to reach floor(N/2) + 1 wins. For N = 1 the majority is
 *   a single win, so the Team that wins the one decisive Game wins the Series.
 * - No winner is declared before that majority is reached; a Series that has
 *   not yet reached the clinching win is still undecided.
 *
 * The function performs no I/O and mutates none of its arguments.
 *
 * _Requirements: 9.10, 9.11, 9.12_
 */

import type { BestOfN } from './types.js';
import { BestOfNValues } from './types.js';
import { ValidationError } from './errors.js';

/**
 * Identifies which of a Series' two Teams won a single Game.
 *
 * - `'A'` — the Game was won by `teamAId`.
 * - `'B'` — the Game was won by `teamBId`.
 */
export type SeriesGameWinner = 'A' | 'B';

/** The two Teams contesting a Series (see {@link SeriesGameWinner}). */
export type SeriesTeam = 'A' | 'B';

/**
 * The outcome of resolving a Series against a sequence of per-Game winners.
 *
 * - `decided: true` carries the `winner` (the Team that reached the majority)
 *   and `clinchedAfter`, the number of Games played up to and including the
 *   Game that clinched the Series.
 * - `decided: false` means neither Team has yet reached a majority of wins; the
 *   Series is still undecided. `winsA`/`winsB` report the current tally.
 */
export type SeriesResult =
  | {
      readonly decided: true;
      readonly winner: SeriesTeam;
      readonly winsA: number;
      readonly winsB: number;
      /** Games played up to and including the clinching Game. */
      readonly clinchedAfter: number;
    }
  | {
      readonly decided: false;
      readonly winsA: number;
      readonly winsB: number;
    };

/** Type guard for the accepted best-of-N values (1, 3, 5, or 7). */
function isValidBestOf(bestOf: number): bestOf is BestOfN {
  return (BestOfNValues as readonly number[]).includes(bestOf);
}

/**
 * The number of Game wins required to clinch a best-of-N Series: a strict
 * majority of N, i.e. floor(N / 2) + 1. For N = 1 this is 1, for N = 7 it is 4.
 */
function majorityThreshold(bestOf: BestOfN): number {
  return Math.floor(bestOf / 2) + 1;
}

/**
 * Resolve a best-of-N Series from an ordered sequence of per-Game winners.
 *
 * Validates that `bestOf` is one of the supported formats (Req 9.10, 9.11),
 * then walks the `gameWinners` in order and declares the first Team to reach a
 * strict majority of wins as the Series winner (Req 9.12). No winner is
 * declared before the majority is reached.
 *
 * @param bestOf      The Series length; must be 1, 3, 5, or 7.
 * @param gameWinners The per-Game winners in the order the Games were played.
 * @throws ValidationError if `bestOf` is not a supported best-of-N value.
 * @returns A decided result (with winner and clinch point) once a Team reaches
 *   the majority, otherwise an undecided result with the current tally.
 */
export function resolveSeries(
  bestOf: number,
  gameWinners: readonly SeriesGameWinner[],
): SeriesResult {
  // Req 9.10 / 9.11: reject any best-of-N outside {1, 3, 5, 7}.
  if (!isValidBestOf(bestOf)) {
    throw new ValidationError(
      'The best-of-N format is not supported; it must be best-of-1, best-of-3, best-of-5, or best-of-7.',
      { bestOf },
    );
  }

  const needed = majorityThreshold(bestOf);

  let winsA = 0;
  let winsB = 0;

  // Req 9.12: walk the Games in order; the first Team to reach a strict
  // majority clinches the Series. Games after the clinch do not change the
  // outcome, so we stop as soon as a majority is reached.
  for (let i = 0; i < gameWinners.length; i++) {
    if (gameWinners[i] === 'A') {
      winsA++;
    } else {
      winsB++;
    }

    if (winsA >= needed) {
      return { decided: true, winner: 'A', winsA, winsB, clinchedAfter: i + 1 };
    }
    if (winsB >= needed) {
      return { decided: true, winner: 'B', winsA, winsB, clinchedAfter: i + 1 };
    }
  }

  // No Team has reached the majority yet: the Series is still undecided.
  return { decided: false, winsA, winsB };
}
