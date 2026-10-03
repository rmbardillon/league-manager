# Implementation Plan: Management UI

## Overview

This plan converts the management-ui design into incremental, test-driven coding steps. The feature is **additive**: it composes onto the existing layered backend (Express 5 + TypeScript, routes → services → repositories → domain) and the existing React 18 + Vite SPA without re-architecting either.

**Scope reminder — what already exists (do NOT re-implement):** the master-Player and roster/assignment backend was shipped by the `player-master-data` spec. `GET /players`, `POST /players`, `GET /teams/:teamId/roster`, `POST|PATCH|DELETE /teams/:teamId/assignments...` all exist and are team/admin-scoped; this feature **consumes** them. The only NEW backend work is the authenticated list-read endpoints (leagues, seasons-by-league, teams/tournaments/playoff-rounds by season, series by round) plus the unauthenticated `GET /public/seasons`, and the small `authorizeRoleRequest` read guard.

Dependency ordering:

1. **Backend read guard + list endpoints (wave 0–2 roots)** — `authorizeRoleRequest` middleware → new `leagues.ts` router → additions to `seasons.ts`/`public.ts` → wire the leagues router in `app.ts`. These depend only on existing repositories and can proceed in parallel with the Mantine setup.
2. **Mantine setup** — deps, PostCSS config, theme, provider wiring in `main.tsx`. Independent of backend work.
3. **API client types + endpoint groups** — depend on nothing (duplicate wire types); build early.
4. **Data hooks** (`useResourceList` + `resourceCache`) — depend on the API client.
5. **Selectors** — depend on hooks + API client + Mantine setup.
6. **Pages** — depend on selectors + API client + Mantine setup; public pages depend on `PublicSeasonSelect`.
7. **Routing/nav** — depends on pages.

Property tests use `fast-check` (already a dev dependency), minimum 100 iterations each, tagged `Feature: management-ui, Property {number}: {property_text}`. Backend route tests are DB-less (stub `db.transaction`, spy repositories), following `publicAwards.test.ts`, `players.test.ts`, and `assignments.test.ts`. Frontend tests use Testing Library wrapped in a `renderWithProviders` helper (MantineProvider + MemoryRouter [+ AuthProvider]).

## Tasks

- [x] 1. Backend read guard and Leagues list endpoints
  - [x] 1.1 Add the `authorizeRoleRequest` read guard
    - In `src/api/middleware/auth.ts`: add `authorizeRoleRequest(allowed: readonly Role[]): RequestHandler` that throws `AuthenticationError` when `req.auth` is absent, `AuthorizationError` when `req.auth.user.role ∉ allowed` (including `null`), else `next()`. Leaves the pure `authorize()` and its property test untouched.
    - _Requirements: 1.6, 1.7, 2.9_
  - [x] 1.2 Create the Leagues router
    - Create `src/api/routes/leagues.ts` exporting `createLeaguesRouter(): Router` and the `LeagueSummary`/`SeasonSummary` payload types. `GET /leagues` → `authenticate()` + `authorizeRoleRequest(['Administrator'])`, returns `LeagueSummary[]` (`{id,name}`) from `leagueRepository.list`, empty → `[]`. `GET /leagues/:leagueId/seasons` → same guards, `withTransaction`: `leagueRepository.findById` existence guard (→ 404), then `seasonRepository.listByLeague` mapped to `SeasonSummary` (`{id,name,startDate,endDate,closed}`, ISO date strings), empty → `[]`.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.8_
  - [ ]* 1.3 Write DB-less route tests for the Leagues router
    - In `src/api/routes/leagues.test.ts` (per `publicAwards.test.ts`): `GET /leagues` 200 + `[{id,name}]`, empty → `[]`, anonymous → 401, Viewer → 403. `GET /leagues/:id/seasons` projected fields, unknown league → 404, empty → `[]`, authz cases.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

- [x] 2. Backend Seasons/Series list endpoints
  - [x] 2.1 Add teams/tournaments/playoff-rounds reads to the Seasons router
    - In `src/api/routes/seasons.ts` `createSeasonsRouter`: add `GET /seasons/:seasonId/teams` → `TeamSummary[]` (`{id,name}`), `GET /seasons/:seasonId/tournaments` → `TournamentSummary[]` (`{id,format,roundRobinKind?}`), `GET /seasons/:seasonId/playoff-rounds` → `PlayoffRoundSummary[]` (`{id,type}`). Each: `authenticate()` + `authorizeRoleRequest(['Administrator'])`, `withTransaction` with a `seasonRepository.findById` existence guard (→ 404), delegating to `teamRepository.listBySeason`/`tournamentRepository.listBySeason`/`playoffRoundRepository.listBySeason`; empty → `[]`. Export the summary payload types.
    - _Requirements: 2.1, 2.2, 2.7, 2.8, 2.9_
  - [x] 2.2 Add the series read to the Series router
    - In `src/api/routes/seasons.ts` `createSeriesRouter`: add `GET /playoff-rounds/:roundId/series` → `SeriesSummary[]` (`{id,teamAId,teamBId,bestOf}`) from `seriesRepository.listByRound`; `authenticate()` + `authorizeRoleRequest(['Administrator'])`; empty → `[]`. Export `SeriesSummary`.
    - _Requirements: 2.9_
  - [ ]* 2.3 Write DB-less route tests for the Seasons/Series reads
    - In `src/api/routes/seasons.test.ts` (extend/create per the DB-less pattern): projected fields for teams/tournaments/playoff-rounds/series; unknown season → 404; empty → `[]`; anonymous → 401; Viewer → 403.
    - _Requirements: 2.1, 2.2, 2.7, 2.8, 2.9_

- [x] 3. Backend public Seasons endpoint and app wiring
  - [x] 3.1 Add the public Seasons endpoint with a pure projection
    - In `src/api/routes/public.ts`: add a pure `toPublicSeason(season): PublicSeasonSummary` that returns exactly `{id,name,closed}` and never `leagueId`/`startDate`/`endDate`/`finalStandingsSnapshot`. Add `GET /public/seasons` (unauthenticated, registered via the existing `registerPublicRoutes`): read seasons across leagues (`leagueRepository.list` → `seasonRepository.listByLeague`) in one `withTransaction`, project via `toPublicSeason`, return `PublicSeasonsPayload` (`{seasons, message?}`); empty → `{seasons: [], message}` never a 404. Export `PublicSeasonSummary`/`PublicSeasonsPayload` and `toPublicSeason`.
    - _Requirements: 7.4, 7.5, 7.6_
  - [ ]* 3.2 Write property test for the public Season projection
    - In `src/api/routes/public.test.ts` (backend Vitest, `fast-check`): **Property 2: Public Season projection exposes only browsing-safe fields** — over generated Seasons (with/without `finalStandingsSnapshot`, arbitrary `leagueId`/dates), assert `Object.keys(toPublicSeason(s)).sort() === ['closed','id','name']`, values equal the source, and none of the management-only keys appear. Min 100 iterations.
    - **Validates: Requirements 7.6**
  - [ ]* 3.3 Write DB-less route test for `GET /public/seasons`
    - No cookie: 200 + `[{id,name,closed}]`; none → empty payload with message (not 404); assert the response objects contain no `startDate`/`endDate`/`leagueId`/`finalStandingsSnapshot` keys (defense-in-depth alongside Property 2).
    - _Requirements: 7.4, 7.5, 7.6_
  - [x] 3.4 Wire the Leagues router into `app.ts`
    - In `src/app.ts`: mount `app.use('/leagues', createLeaguesRouter())` alongside the existing routers (public-seasons registers via the existing `registerPublicRoutes`; no other new mounts needed).
    - _Requirements: 1.1, 7.4_

- [x] 4. Checkpoint - Ensure backend endpoint tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Mantine setup
  - [x] 5.1 Add Mantine dependencies and PostCSS config
    - In `web/package.json`: add `@mantine/core`, `@mantine/hooks`, `@mantine/form`, `@mantine/notifications` (dependencies) and `postcss`, `postcss-preset-mantine`, `postcss-simple-vars` (devDependencies). Create `web/postcss.config.cjs` with `postcss-preset-mantine` + the Mantine breakpoint variables.
    - _Requirements: 10.1_
  - [x] 5.2 Add the shared theme and wire the providers
    - Create `web/src/theme.ts` exporting a single `createTheme({...})` (primary color, font, default radius). In `web/src/main.tsx`: import `@mantine/core/styles.css` and `@mantine/notifications/styles.css` then `styles.css`, wrap the app in `MantineProvider theme={theme}`, and mount the `Notifications` portal above `App`.
    - _Requirements: 10.1_

- [x] 6. API client types and endpoint groups
  - [x] 6.1 Add/replace wire types in the API client
    - In `web/src/api/types.ts`: add `LeagueSummary`, `SeasonSummary`, `TeamSummary`, `TournamentSummary`, `PlayoffRoundSummary`, `SeriesSummary`, `PublicSeasonSummary`, `PublicSeasonsPayload`, `CreateSeasonRequest`, `CreateTournamentRequest`, `CreatePlayoffRoundRequest`, `CreateSeriesRequest`, `CreatePlayoffGameRequest`. Replace the stale team-scoped player types with master `Player {id,name}`, `RosterEntry {playerId,name,jerseyNumber}`, `RosterAssignment {id,playerId,teamId,jerseyNumber}`, `CreatePlayerRequest {name}`, `AssignPlayerRequest {playerId,jerseyNumber}`, `UpdateJerseyRequest {jerseyNumber}`; retire `AddPlayerRequest`/`UpdatePlayerRequest` and the old `Player {teamId,jerseyNumber}`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.9, 6.4, 7.4_
  - [x] 6.2 Add/replace endpoint groups
    - In `web/src/api/endpoints.ts` (re-exported from `web/src/api/index.ts`): add `leaguesApi` (`list`, `seasons`), extend `seasonsApi` (`create`, `close`, `teams`, `tournaments`, `createTournament`, `playoffRounds`, `createPlayoffRound`, `createPlayoffGame`), add `playoffApi` (`series`, `createSeries`), add master-player `playersApi` (`listMasters` → `GET /players`, `createMaster` → `POST /players`), add `assignmentsApi` (`roster`, `assign`, `updateJersey`, `unassign`), extend `publicApi` with `seasons()`. Retire the stale team-scoped `playersApi.add/update/remove`. Each list fn forwards its `AbortSignal` to `request<T>`.
    - _Requirements: 2.1, 2.2, 2.3, 3.9, 4.2, 4.5, 6.4, 6.5, 6.8, 6.9, 7.4, 8.2, 9.2, 9.4, 9.6_

- [x] 7. Data-loading hooks
  - [x] 7.1 Add the resource cache and `useResourceList` hook
    - Create `web/src/api/resourceCache.ts` (tiny in-memory cache keyed by request path, with per-key invalidation after a mutation). Create `web/src/hooks/useResourceList.ts` wrapping the existing `useAsync`: returns `{ items, loading, error, reload }`, normalizes `null`/error, skips the loader when `key` is `null` (cascading gate). Clearing a parent resets the child.
    - _Requirements: 3.3, 3.4, 3.6, 3.7, 3.8_

- [x] 8. Reusable selector components
  - [x] 8.1 Implement the generic `EntitySelect` with pure option helpers
    - Create `web/src/components/selectors/EntitySelect.tsx`: pure `buildOptions(items, getId, getLabel): SelectOption[]` (value is ALWAYS the entity id) and `resolveById(items, getId, id)`. The component wraps Mantine `Select`, presents options by name, calls `onChange(id)`, disables + shows a spinner while `loading` (3.6), renders an accessible empty state (`role="status"`, no free-text id fallback) when empty (3.7), and renders an `Alert` (`role="alert"`) + Retry wired to `onRetry` on error (3.8).
    - _Requirements: 3.1, 3.5, 3.6, 3.7, 3.8, 10.2, 11.5_
  - [ ]* 8.2 Write property test for selector name/identifier resolution
    - In `web/src/components/selectors/EntitySelect.test.ts` (`fast-check`): **Property 1: Selector name/identifier resolution round trip** — over generated `{id,name}[]` (unique ids; names may duplicate, be empty, or Unicode) and a random chosen entity, assert `resolveById(items, getId, buildOptions(...)[chosenIndex].value)?.id === chosen.id` and the built option's `label === getLabel(chosen)`. Min 100 iterations.
    - **Validates: Requirements 3.5, 7.2**
  - [x] 8.3 Implement the API-backed cascading selectors
    - Create `web/src/components/selectors/LeagueSelect.tsx`, `SeasonSelect.tsx`, `TeamSelect.tsx`, `PlayerSelect.tsx` as `EntitySelect` wrappers bound via `useResourceList` to `leaguesApi`/`seasonsApi.teams`/`playersApi.listMasters`, with the cascading keys (season keys off leagueId, team off seasonId). `PlayerSelect` lists master Players by name with option value = Player id (duplicate names stay unambiguous).
    - _Requirements: 3.2, 3.3, 3.4, 3.9_
  - [x] 8.4 Implement the static-value selects
    - Create `web/src/components/selectors/TournamentFormatSelect.tsx`, `RoundRobinKindSelect.tsx`, `PlayoffRoundTypeSelect.tsx`, `BestOfSelect.tsx` as `EntitySelect` instances over static option arrays so the UI can only offer valid values.
    - _Requirements: 8.2, 8.3, 9.2, 9.4_

- [x] 9. Checkpoint - Ensure selector/hook tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Season management page
  - [x] 10.1 Implement `SeasonsPage`
    - Create `web/src/pages/manage/SeasonsPage.tsx`: `LeagueSelect` → Mantine `Table` of the league's seasons (name/start/end/closed) via `leaguesApi.seasons`. Create-season `@mantine/form` (name 1–100, start/end `DateInput`, end strictly after start) calling `seasonsApi.create`; close via a Mantine confirm modal calling `seasonsApi.close`; closed rows show the close action disabled; success/failure notifications; empty league → empty state (`role="status"`). Field errors from `ValidationError`/`ConflictError` `details.field` set inline via `setFieldError`.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 10.4, 10.5_

- [x] 11. Team management page
  - [x] 11.1 Rewrite `TeamsPage` to be list-backed
    - Rewrite `web/src/pages/manage/TeamsPage.tsx`: `LeagueSelect` → `SeasonSelect` → Mantine `Table` from `seasonsApi.teams(seasonId)` (API-backed, survives refresh). Create form (name 1–100); rename via a Mantine modal form (replacing `window.prompt`); delete via a confirm modal (replacing `window.confirm`). After each mutation invalidate the list key and refetch; notifications for success/failure; server `ValidationError`/`ConflictError` with `details.field` inline; empty → empty state.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 10.4, 10.5, 10.6_

- [x] 12. Roster management page
  - [x] 12.1 Rewrite `PlayersPage` to the master-player + assignment model
    - Rewrite `web/src/pages/manage/PlayersPage.tsx`: `SeasonSelect` → `TeamSelect` → roster `Table` from `assignmentsApi.roster(teamId)` (name + jersey). Assign form: `PlayerSelect` (master players) + jersey `NumberInput` (0–99 integer) → `assignmentsApi.assign`. "New player" modal (name 1–100) → `playersApi.createMaster` then `assignmentsApi.assign` — shown only to an Administrator. Change-jersey form → `assignmentsApi.updateJersey`. Unassign via confirm modal → `assignmentsApi.unassign` (master Player retained). When a Team_Manager and `!canManageTeam(selectedTeamId)`, render assign/change-jersey/unassign/new-player controls disabled with an accessible notice. Inline validation mirrors server bounds; `ConflictError` (duplicate jersey / same-Season second assignment) surfaces inline on the assign form; empty roster → empty state.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 10.4, 10.5, 10.6, 11.3_

- [x] 13. Tournament and Playoff management pages
  - [x] 13.1 Implement `TournamentsPage`
    - Create `web/src/pages/manage/TournamentsPage.tsx`: `SeasonSelect` → Mantine `Table` from `seasonsApi.tournaments(seasonId)` (format + round-robin kind). Create form with `TournamentFormatSelect`; when `round-robin` is chosen the `RoundRobinKindSelect` becomes required and is validated before submit. Notifications + empty state.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
  - [x] 13.2 Implement `PlayoffsPage`
    - Create `web/src/pages/manage/PlayoffsPage.tsx`: `SeasonSelect` gates three sub-forms — create Round (`PlayoffRoundTypeSelect` → `seasonsApi.createPlayoffRound`); create Series (round select from `seasonsApi.playoffRounds`, two `TeamSelect`s, `BestOfSelect` → `playoffApi.createSeries`); create Playoff Game (round select, two `TeamSelect`s, `DateInput`, optional Series select from `playoffApi.series(roundId)` → `seasonsApi.createPlayoffGame`). Client validation rejects identical teams before submit; closed-season and other server errors surface as notifications. All choices are Selectors — no id entry.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10_

- [x] 14. Public browsing Season selector
  - [x] 14.1 Implement `PublicSeasonSelect` and wire the public pages
    - Create `web/src/components/PublicSeasonSelect.tsx` backed by `publicApi.seasons()` (labeled Mantine `Select`, resolves to the Season id, empty → accessible empty state with no free-text fallback). Replace the `SeasonPicker` free-text input in `web/src/pages/public/SchedulePage.tsx`, `ResultsPage.tsx`, `StandingsPage.tsx`, and `AwardsPage.tsx`, writing the resolved id to the `season` query param (deep-link preserved).
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 15. Routing and navigation
  - [x] 15.1 Add management routes
    - In `web/src/App.tsx`: add `manage/seasons`, `manage/tournaments`, `manage/playoffs` routes (Admin-gated via the existing `ProtectedRoute requireAdmin`), keep `manage/teams` (Admin) and `manage/players` (auth).
    - _Requirements: 4.1, 8.1, 9.1_
  - [x] 15.2 Add navigation links
    - In `web/src/components/Layout.tsx`: add "Seasons", "Tournaments", "Playoffs" links under the authenticated/admin nav section.
    - _Requirements: 10.1_

- [x] 16. Checkpoint - Ensure page/component tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 17. Frontend tests
  - [ ]* 17.1 Add the `renderWithProviders` test helper
    - Create `web/src/test/renderWithProviders.tsx` wrapping components in `MantineProvider` + `MemoryRouter` (+ `AuthProvider` when needed), including a `matchMedia` shim if the jsdom setup needs it.
    - _Requirements: 11.1_
  - [ ]* 17.2 Write `EntitySelect` component tests
    - In `web/src/components/selectors/EntitySelect.test.tsx`: labeled combobox (`getByRole('combobox', {name})`); options by name; keyboard-openable; disabled + spinner while loading (3.6); empty state with no text-id field (3.7); error `Alert` + Retry re-invokes loader (3.8); selecting calls `onChange` with the entity id (3.5).
    - _Requirements: 3.5, 3.6, 3.7, 3.8, 11.1, 11.5_
  - [ ]* 17.3 Write a management page test (Teams or Seasons)
    - Mock `web/src/api`: assert the API-backed list renders and re-renders after a create (refetch, proving refresh-independence); rename/delete use Mantine modal + confirm (no `window.*`); success/failure notifications; server `ValidationError` with `details.field` renders inline.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 11.2_
  - [ ]* 17.4 Write the Roster page test
    - In `web/src/pages/manage/PlayersPage.test.tsx`: mock `playersApi`/`assignmentsApi`. Assert roster renders + refetches after a mutation; `PlayerSelect` lists masters by name (duplicates distinguishable by id); assign calls `assignmentsApi.assign` with success notification; "New player" modal calls `createMaster` then `assign`; `ConflictError` (duplicate jersey / same-Season) renders inline; change-jersey calls `updateJersey`; unassign uses confirm modal; empty roster → empty state; Team_Manager unmanaged-team disables controls + shows notice; "New player" shown only to Administrator.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 11.3_
  - [ ]* 17.5 Write the public Season selector test
    - Mock `publicApi.seasons`: assert `PublicSeasonSelect` lists seasons by name, resolves to the id (writes the `season` query param), and shows an accessible empty state with no free-text fallback.
    - _Requirements: 7.1, 7.2, 7.3, 11.1_

- [x] 18. Final checkpoint - Ensure typecheck, lint, build, and tests pass
  - Run `npm run typecheck`, `npm run lint`, `npm run build`, `npm test` (backend) and `npm test --workspace web`; confirm all green with no new failures (Req 11.4). Grep `web/src/pages/manage` and `web/src/components` for `window.prompt|window.confirm|window.alert` and confirm none remain (Req 10.6). Confirm no raw-UUID free-text entry remains in management/browsing flows (Req 11.5). Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (test-related) and can be skipped for a faster MVP, but are recommended for correctness.
- Each leaf task references specific requirements for traceability; property tasks also reference their design property number.
- **No backend player/roster work:** `GET /players`, `POST /players`, and `GET|POST|PATCH|DELETE /teams/:teamId/...` assignment/roster routes already exist (shipped by `player-master-data`); this feature only consumes them. The new backend work is the list-read endpoints + `GET /public/seasons` + the `authorizeRoleRequest` guard.
- Property tests run minimum 100 iterations with `fast-check`, tagged `Feature: management-ui, Property N: <text>`. Property 1 (selector name→id resolution) runs in the web Vitest project; Property 2 (public Season projection) runs in the backend Vitest project since `toPublicSeason` lives in `public.ts`.
- The backend list endpoints and the Mantine setup are independent and can proceed in parallel; the API client types/endpoints have no dependencies and are built early; hooks depend on the client, selectors on hooks + client + Mantine, pages on selectors + client + Mantine, routing on pages.
- Checkpoints provide incremental validation after the backend endpoints, after selectors/hooks, after pages, and a final toolchain gate.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "5.1", "6.1"] },
    { "id": 1, "tasks": ["1.2", "3.1", "5.2", "6.2"] },
    { "id": 2, "tasks": ["1.3", "2.1", "3.2", "3.3", "7.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "3.4", "8.1"] },
    { "id": 4, "tasks": ["8.2", "8.3", "8.4"] },
    { "id": 5, "tasks": ["10.1", "11.1", "12.1", "13.1", "13.2", "14.1"] },
    { "id": 6, "tasks": ["15.1", "15.2", "17.1", "17.2"] },
    { "id": 7, "tasks": ["17.3", "17.4", "17.5"] }
  ]
}
```
