/**
 * Pure authorization decision function for the Authorization_Service.
 *
 * This module contains the role-based, team-scoped access-control rule as a
 * pure, I/O-free function so it can be property-tested in isolation and reused
 * by the auth middleware and application services.
 *
 * Decision rule (Requirement 2, plus 4.4 and 12.1):
 * - An Administrator is allowed to perform any create/update/delete operation
 *   on any resource (Req 2.4).
 * - A Team_Manager is allowed to act only on a Team in their managed set, and
 *   only on team-scoped resources (Req 2.2, 4.4). They are denied on
 *   league/season-scoped operations such as automatic schedule generation,
 *   which requires Administrator privileges (Req 12.1).
 * - A Viewer is denied every create/update/delete operation (Req 2.3).
 * - A User with no primary role is denied every operation (Req 2.5).
 *
 * The function never mutates the supplied `user` or `resource`; it only
 * returns a decision. Callers are responsible for leaving the target resource
 * unchanged when the decision is a denial (Req 2.2, 2.3).
 *
 * _Requirements: 2.2, 2.3, 2.4, 2.5, 4.4, 12.1_
 */

import type { Role } from './types.js';

/**
 * The authenticated principal an authorization decision is made for.
 *
 * `role` is `null` when the User has no primary role assigned, in which case
 * every operation is denied (Req 2.5). `managedTeamIds` lists the Teams a
 * Team_Manager is assigned to (empty for other roles).
 */
export interface AuthUser {
  readonly id: string;
  readonly role: Role | null;
  readonly managedTeamIds: readonly string[];
}

/** The mutating operations governed by the Authorization_Service. */
export type Action = 'create' | 'update' | 'delete';

/** Runtime tuple of all governed {@link Action} values. */
export const Actions = ['create', 'update', 'delete'] as const satisfies readonly Action[];

/**
 * A reference to the resource an action targets.
 *
 * - `team`: a Team-scoped resource (Team, or a Player/roster entry that belongs
 *   to a Team). `teamId` identifies the owning Team for team-scope checks
 *   (Req 2.2, 4.4).
 * - `schedule-generation`: an automatic schedule-generation operation that is
 *   restricted to Administrators (Req 12.1).
 * - `admin`: any other Administrator-only resource (e.g. Users, Seasons).
 */
export type ResourceRef =
  | { readonly kind: 'team'; readonly teamId: string }
  | { readonly kind: 'schedule-generation' }
  | { readonly kind: 'admin' };

/** The outcome of an authorization decision. */
export type AuthDecision = { allowed: true } | { allowed: false; reason: string };

/**
 * Decide whether `user` may perform `action` on `resource`.
 *
 * Pure: performs no I/O and mutates neither argument. The `action` parameter is
 * part of the stable Authorization_Service contract; the current rule treats
 * every governed action (create/update/delete) uniformly, so the decision is
 * driven by role and team scope.
 */
export function authorize(
  user: AuthUser,
  _action: Action,
  resource: ResourceRef,
): AuthDecision {
  // Req 2.5: a User with no primary role is denied every operation.
  if (user.role === null) {
    return { allowed: false, reason: 'No role is assigned to the user.' };
  }

  // Req 2.4: an Administrator has full create/read/update/delete access.
  if (user.role === 'Administrator') {
    return { allowed: true };
  }

  // Req 2.3: a Viewer is denied every create/update/delete operation.
  if (user.role === 'Viewer') {
    return {
      allowed: false,
      reason: 'The requested operation is not permitted for the Viewer role.',
    };
  }

  // user.role === 'Team_Manager' from here.

  // Req 12.1: automatic schedule generation requires Administrator privileges.
  if (resource.kind === 'schedule-generation') {
    return {
      allowed: false,
      reason: 'Automatic schedule generation requires Administrator privileges.',
    };
  }

  // A Team_Manager may act only on team-scoped resources, never on other
  // Administrator-only resources (Users, Seasons, etc.).
  if (resource.kind !== 'team') {
    return {
      allowed: false,
      reason: 'The user is not authorized for this resource.',
    };
  }

  // Req 2.2 / 4.4: a Team_Manager may act only on a Team in their managed set.
  if (user.managedTeamIds.includes(resource.teamId)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: 'The user is not authorized for that Team.',
  };
}
