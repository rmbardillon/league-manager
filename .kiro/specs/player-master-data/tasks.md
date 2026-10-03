# Implementation Plan: Player Master Data

## Overview

This plan converts the player-master-data design into incremental, test-driven coding steps. The feature is backend/domain only (no UI). It splits the team-scoped `Player` into a master `Player` `{id, name}` plus a `Roster_Assignment` `{id, playerId, teamId, jerseyNumber}`, migrates existing data losslessly (identity preserved), and reconciles statistics, awards, and batch upload with the new model.

Dependency ordering:

1. **Schema + migration (wave 0 root)** — reshape `players`, add `roster_assignments`, extract the pure `backfillPlayers` transform, hand-edit the generated SQL to embed the ordered create → backfill → drop steps, and update mappers. Everything else depends on this.
2. **Repositories** — reshape `playerRepository` to master CRUD; add `rosterAssignmentRepository`. Depend on the schema.
3. **Domain types** — reshape `Player`, add `RosterAssignment`/`RosterEntry`/`PlayerHistoryEntry`. The pure domain (`statistics.ts`, `finals.ts`) keeps its context shapes, so only services that build those contexts change.
4. **Services** — `playerService` (master + assignment methods), `statisticsService`, `awardsService`, `batchUploadService`. Depend on repositories + domain types.
5. **API routes** — split `players.ts` into master player routes + new `assignments.ts`; wire routers in `app.ts`. Depend on services.

Property tests use `fast-check` with Vitest, minimum 100 iterations each, tagged:
`// Feature: player-master-data, Property {number}: {property_text}`
Service/route tests are DB-less (stub `db.transaction`, spy repositories), following `batchUploadService.test.ts` and `publicAwards.test.ts`.

## Tasks

- [x] 1. Schema, migration, and backfill foundation
  - [x] 1.1 Reshape the Drizzle schema and add `roster_assignments`
    - In `src/db/schema.ts`: reshape `players` to `{id, name}` — drop `team_id`, `jersey_number`, the `players_team_jersey_uq` unique and `players_jersey_range_chk` check; keep the `players_name_len_chk` 1–100 check.
    - Add the `roster_assignments` table: `{id, player_id FK→players onDelete restrict, team_id FK→teams onDelete cascade, jersey_number smallint}` with `unique(team_id, jersey_number)` (`roster_assignments_team_jersey_uq`) and a `roster_assignments_jersey_range_chk` 0–99 check.
    - Add inferred row types `RosterAssignmentRow` / `NewRosterAssignmentRow`. Leave `statistics` and `award_players` untouched (their `player_id` FK keeps pointing at `players.id`).
    - _Requirements: 1.1, 1.8, 3.1, 5.1, 6.1_
  - [x] 1.2 Extract the pure `backfillPlayers` transform
    - Create `src/db/migrateBackfill.ts` exporting `LegacyPlayerRow`, `BackfillOutput`, and `backfillPlayers(rows): { players: {id,name}[], assignments: {playerId,teamId,jerseyNumber}[] }`.
    - Produce exactly one master player (id preserved: `master.id === legacy.id`) and one assignment (`playerId === legacy.id`) per legacy row; preserve name, team, jersey.
    - _Requirements: 7.1, 7.2, 7.3_
  - [x]* 1.3 Write property tests for `backfillPlayers`
    - **Property 12: Migration losslessness and post-conditions** — **Validates: Requirements 7.1, 7.3, 7.4, 9.4**
    - **Property 13: Migration id-preservation round trip** — **Validates: Requirements 5.1, 6.1, 7.2**
    - **Property 14: Migration idempotence** (applying the guarded transform twice equals once) — **Validates: Requirements 7.5**
  - [x] 1.4 Generate and hand-edit the migration SQL
    - Run `npm run db:generate` to emit the next timestamped file under `./drizzle` (after `0001_motionless_black_queen`).
    - Hand-edit the generated SQL to execute in order with statement-breakpoints: (1) create `roster_assignments`; (2) idempotent backfill `INSERT INTO roster_assignments (id, player_id, team_id, jersey_number) SELECT gen_random_uuid(), p.id, p.team_id, p.jersey_number FROM players p WHERE NOT EXISTS (SELECT 1 FROM roster_assignments ra WHERE ra.player_id = p.id)`; (3) drop old players columns/constraints with `IF EXISTS`.
    - Keep `statistics` / `award_players` untouched; no FK dropped or re-pointed.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  - [x] 1.5 Update repository mappers for the new shapes
    - In `src/repositories/mappers.ts`: change `toPlayer` to map a row to `{id, name}` (drop `teamId`/`jerseyNumber`); add `toRosterAssignment` mapping a `roster_assignments` row to `{id, playerId, teamId, jerseyNumber}`.
    - _Requirements: 1.1, 2.1_
  - [x]* 1.6 Write unit tests for the updated mappers
    - Assert `toPlayer` yields `{id, name}` only and `toRosterAssignment` yields the full assignment shape.
    - _Requirements: 1.1, 2.1_

- [x] 2. Checkpoint - Ensure pure/migration-layer tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Repository layer
  - [x] 3.1 Reshape `playerRepository` to master CRUD
    - In `src/repositories/playerRepository.ts`: implement `create({name})`, `createMany`, `findById`, `list`, `update(id, {name})`, `delete(id)` over the `Executor` pattern; remove `listByTeam`.
    - _Requirements: 1.1, 1.4, 1.5, 1.7, 1.9_
  - [x] 3.2 Add `rosterAssignmentRepository`
    - Create `src/repositories/rosterAssignmentRepository.ts` with `create`, `createMany`, `findByPlayerAndTeam`, `listByTeam`, `listByPlayer`, `listByPlayerInSeason` (joins `roster_assignments → teams` on `teams.season_id`), `updateJersey`, `delete`; data-access only, no business rules.
    - Register it in `src/repositories/index.ts`.
    - _Requirements: 2.1, 3.2, 4.1, 4.3, 5.4_

- [x] 4. Domain types
  - [x] 4.1 Update domain types for the model split
    - In `src/domain/types.ts`: replace `Player` with master `{id, name}`; add `RosterAssignment {id, playerId, teamId, jerseyNumber}`, `RosterEntry {playerId, name, jerseyNumber}`, `PlayerHistoryEntry {assignmentId, teamId, seasonId, jerseyNumber}`.
    - Confirm `EligibilityContext`/`RosterContext` (`src/domain/statistics.ts`) and `FinalsCandidate` (`src/domain/finals.ts`) shapes stay the same — no pure-domain rewrite.
    - _Requirements: 1.1, 2.1, 4.1, 4.3_

- [x] 5. Player service: master and assignment methods
  - [x] 5.1 Implement master Player methods in `playerService`
    - In `src/services/playerService.ts`: `createPlayer` (admin authorize, name 1–100, duplicate name allowed, return `{id,name}`), `getPlayer` (NotFound if absent), `listPlayers`, `updatePlayer` (exist-check, name validation, assignments untouched), `removePlayer` (exist-check; ConflictError if `listByPlayer` non-empty, else delete; run in a transaction, DB `restrict` as backstop).
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9_
  - [x]* 5.2 Write property test for Player identity shape and non-unique names
    - **Property 1: Master Player identity shape and non-unique names** — **Validates: Requirements 1.1, 1.3, 1.4**
  - [x]* 5.3 Write property test for rename preserving assignments
    - **Property 2: Rename preserves assignments** — **Validates: Requirements 1.6**
  - [x]* 5.4 Write property test for deletion gating
    - **Property 3: Deletion gating** — **Validates: Requirements 1.8, 1.9**
  - [x] 5.5 Implement assignment methods in `playerService`
    - `assignPlayer` (authorize on `teamId` first → no reads before auth; validate jersey 0–99 integer; in a transaction: Team exists → NotFound(Team), Player exists → NotFound(Player), jersey free on roster → ConflictError, one-per-season via `listByPlayerInSeason` → ConflictError same-season while cross-season passes; create and return).
    - `unassignPlayer` (authorize on team; find by `(playerId, teamId)`; NotFound if absent; else delete, retaining master Player and other assignments).
    - `updateAssignmentJersey` (authorize on team; find assignment → NotFound if absent; validate range; jersey free excluding this assignment → ConflictError; update).
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 9.2_
  - [x]* 5.6 Write property test for jersey uniqueness within a Team
    - **Property 4: Jersey uniqueness within a Team** — **Validates: Requirements 2.7, 3.1**
  - [x]* 5.7 Write property test for one-per-season (cross-season allowed)
    - **Property 5: One assignment per Player per Season (cross-Season allowed)** — **Validates: Requirements 3.2, 3.3**
  - [x]* 5.8 Write property test for unassign isolation
    - **Property 6: Unassign isolation** — **Validates: Requirements 2.5**
  - [x]* 5.9 Write property test for authorization non-disclosure
    - **Property 7: Authorization non-disclosure** — **Validates: Requirements 2.2, 2.3, 3.6, 9.2**
  - [x] 5.10 Implement roster and player-history reads in `playerService`
    - `getTeamRoster(teamId)` — join assignments to master names → `[{playerId, name, jerseyNumber}]`; empty Team yields `[]` with no error.
    - `getPlayerHistory(playerId)` — assignments joined to `teams.season_id` → `[{assignmentId, teamId, seasonId, jerseyNumber}]`.
    - _Requirements: 4.1, 4.2, 4.3_
  - [x]* 5.11 Write property tests for roster and history read shapes
    - **Property 8: Roster read shape (including empty)** — **Validates: Requirements 4.1, 4.2**
    - **Property 9: Player history shape** — **Validates: Requirements 4.3**

- [x] 6. Checkpoint - Ensure player service tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Statistics service reconciliation
  - [x] 7.1 Build player→team mapping from assignments in `statisticsService`
    - In `src/services/statisticsService.ts`: build `playerTeamById` in `buildEligibilityContext(game)` from `rosterAssignmentRepository.listByTeam(homeTeamId)` and `listByTeam(awayTeamId)` (eligible iff assigned to home or away Team for the Game's Season).
    - `getPlayerSeasonStats` resolves the Player's Season team via `listByPlayerInSeason(playerId, seasonId)`; `getTeamSeasonStats` builds the roster map via `rosterAssignmentRepository.listByTeam(teamId)`. Pure `validateStatistic`/`aggregateStatistics` unchanged.
    - _Requirements: 5.2, 5.3, 5.4_
  - [x]* 7.2 Write property test for assignment-based eligibility
    - **Property 10: Assignment-based eligibility** — **Validates: Requirements 5.2, 5.3**
  - [x]* 7.3 Write property test for assignment-based aggregation attribution
    - **Property 11: Assignment-based aggregation attribution** — **Validates: Requirements 5.4**

- [x] 8. Awards service reconciliation
  - [x] 8.1 Build champion candidate pool from assignments in `awardsService`
    - In `src/services/awardsService.ts`: in `computeFinalsMvpForScope`, build the champion candidate pool from `rosterAssignmentRepository.listByTeam(championTeamId)` joined to master names → `FinalsCandidate {playerId, name}`. `loadPlayerNames` still uses `playerRepository.findById`; pure `computeFinalsMvp`/`computeRegularSeasonAwards` unchanged, so award references stay master-Player ids.
    - _Requirements: 6.1, 6.2_
  - [x]* 8.2 Write unit test for assignment-based candidate-pool derivation
    - Assert the candidate pool for a scope is derived from the champion Team's assignments within the scope's Season and resolves master names.
    - _Requirements: 6.2_

- [x] 9. Batch upload reconciliation
  - [x] 9.1 Create a master Player + assignment per row in `batchUploadService`
    - In `src/services/batchUploadService.ts`: change `importRows` so each row creates a new master Player `{name}` (never reuse an existing master) then a `roster_assignment` linking it to the row's Team with the row's jersey, all in one `withTransaction` unit (all-or-nothing). Keep result shape `{teamsCreated, playersCreated, importedRecords}` with `playersCreated` counting one master per row. Pure `validateBatch` unchanged.
    - _Requirements: 8.1, 8.2, 8.3_
  - [x] 9.2 Update the batch upload service test to the new create shapes
    - In `src/services/batchUploadService.test.ts`: update expected repository calls from `{teamId, name, jerseyNumber}` to a master create `{name}` plus an assignment create; keep the all-or-nothing rejection assertions.
    - _Requirements: 8.1, 8.2_
  - [x]* 9.3 Write property test for batch creating a new master and assignment per row
    - **Property 15: Batch creates a new master and assignment per row** — **Validates: Requirements 8.1, 8.3**

- [x] 10. Checkpoint - Ensure all service tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. API routes
  - [x] 11.1 Split `players.ts` into master Player routes
    - In `src/api/routes/players.ts`: `POST /players` `{name}` → `201 {id,name}`; `GET /players`; `GET /players/:playerId`; `PATCH /players/:playerId` `{name}`; `DELETE /players/:playerId` → `204`/`404`/`409`; `GET /players/:playerId/history`. Administrator-scoped via `authorizeRequest(..., () => ({kind:'admin'}))`; keep `authenticate()` + central `errorHandler` mapping.
    - _Requirements: 1.1, 1.4, 1.5, 1.7, 1.8, 1.9, 4.3, 9.1_
  - [x] 11.2 Add team-scoped `assignments.ts` routes
    - Create `src/api/routes/assignments.ts`: `POST /teams/:teamId/assignments` `{playerId, jerseyNumber}`; `PATCH /teams/:teamId/assignments/:playerId` `{jerseyNumber}`; `DELETE /teams/:teamId/assignments/:playerId` → `204`; `GET /teams/:teamId/roster`. Team-scoped via `authorizeRequest(..., req => ({kind:'team', teamId: req.params.teamId}))`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 4.1, 4.2, 9.2_
  - [x] 11.3 Wire the routers in `app.ts`
    - In `src/app.ts`: mount the reshaped master player router and the new assignments router.
    - _Requirements: 9.1_
  - [x]* 11.4 Write DB-less route tests for players and assignments
    - Using `supertest` with stubbed services (per `publicAwards.test.ts`): assert status mapping for create/get/update/delete/history and assignment assign/unassign/jersey/roster, including `403` non-disclosure, `404`, and `409` cases.
    - _Requirements: 1.5, 2.3, 2.6, 3.1, 3.2, 4.2_

- [x] 12. Identity-preservation verification
  - [x]* 12.1 Verify existing statistics/award references resolve post-migration
    - DB-backed integration check (gated on `DATABASE_URL`, skipped without one): apply the generated migration to a seeded legacy dataset and assert a sample `statistics.player_id` and `award_players.player_id` still join to a migrated master Player, with row counts and field preservation intact (no data loss).
    - _Requirements: 5.1, 6.1, 7.2, 7.3, 9.4_

- [x] 13. Final checkpoint - Ensure typecheck, lint, build, and tests pass
  - Run the project's typecheck, lint, build, and test steps; confirm all green and no data loss (Req 9.3, 9.4). Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (test-related) and can be skipped for a faster MVP, but are recommended for correctness.
- Each leaf task references specific requirements for traceability; property tasks also reference their design property number.
- Task 1 (schema + pure backfill + migration + mappers) is the root dependency — everything else builds on it.
- `statistics.player_id` and `award_players.player_id` are NOT migrated or changed; identity is preserved by keeping each legacy `players.id` as the master id. Task 12.1 verifies those references still resolve.
- Property tests run minimum 100 iterations with `fast-check`, tagged `Feature: player-master-data, Property N: <text>`; service/route tests are DB-less (stub `db.transaction`, spy repositories).
- Checkpoints provide incremental validation points after the migration layer, after services, and at the end.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.5"] },
    { "id": 2, "tasks": ["1.3", "1.4", "1.6", "3.1", "3.2", "4.1"] },
    { "id": 3, "tasks": ["5.1", "7.1", "8.1", "9.1"] },
    { "id": 4, "tasks": ["5.5", "5.2", "5.3", "5.4", "7.2", "7.3", "8.2", "9.2", "11.2"] },
    { "id": 5, "tasks": ["5.10", "5.6", "5.7", "5.8", "5.9", "9.3", "11.1"] },
    { "id": 6, "tasks": ["5.11", "11.3"] },
    { "id": 7, "tasks": ["11.4", "12.1"] }
  ]
}
```
