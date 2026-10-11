# Feature Gap Analysis

A review of the implemented backend against the design document, and of the
frontend against the backend. The goal is a single list of what is missing on
each side so the remaining work can be planned.

Method: every Express route registered in `src/app.ts` was enumerated and
cross-checked against (a) the service methods that exist in `src/services`, and
(b) the typed endpoints wired in `web/src/api/endpoints.ts` and the pages that
call them. The design document (`.kiro/specs/basketball-league-management/
design.md`, Requirements 1-13) was used as the intended-scope baseline.

Legend: [DONE] implemented end to end - [BACKEND-ONLY] backend route exists but
no UI - [MISSING-BOTH] neither backend route nor UI - [PARTIAL] partially done.

---

## 1. Backend route inventory (ground truth)

Routes currently mounted in `src/app.ts`:

Auth (`/auth`)
- POST `/auth/signin`            [DONE] used by SignInPage
- POST `/auth/signout`           [DONE] used by Layout sign-out
- GET  `/auth/me`                [DONE] used by AuthContext restore

Public, unauthenticated (`/public`)
- GET `/public/seasons`                      [DONE] PublicSeasonSelect
- GET `/public/seasons/:id/schedule`         [DONE] SchedulePage
- GET `/public/seasons/:id/results`          [DONE] ResultsPage
- GET `/public/seasons/:id/standings`        [DONE] StandingsPage
- GET `/public/scopes/:scopeId/awards`       [DONE] AwardsPage

Leagues (`/leagues`, Admin)
- GET `/leagues`                 [DONE] LeagueSelect
- GET `/leagues/:id/seasons`     [DONE] SeasonSelect / SeasonsPage

Seasons + Tournaments + Playoffs (`/seasons`, `/playoff-rounds`, Admin)
- GET  `/seasons/:id/teams`              [DONE] TeamSelect / TeamsPage
- GET  `/seasons/:id/tournaments`        [DONE] TournamentsPage
- GET  `/seasons/:id/playoff-rounds`     [DONE] PlayoffsPage
- GET  `/playoff-rounds/:id/series`      [DONE] PlayoffsPage
- POST `/seasons`                        [DONE] SeasonsPage
- POST `/seasons/:id/close`              [DONE] SeasonsPage
- POST `/seasons/:id/tournaments`        [DONE] TournamentsPage
- POST `/seasons/:id/playoff-rounds`     [DONE] PlayoffsPage
- POST `/seasons/:id/playoff-games`      [DONE] PlayoffsPage
- POST `/playoff-rounds/:id/series`      [DONE] PlayoffsPage

Teams (`/teams`, Admin)
- POST   `/teams`                [DONE] TeamsPage
- PATCH  `/teams/:id`            [DONE] TeamsPage
- DELETE `/teams/:id`            [DONE] TeamsPage

Players master data (`/players`, Admin)
- POST   `/players`              [DONE] PlayersRegistryPage + roster "New player"
- GET    `/players`              [DONE] PlayerSelect / PlayersRegistryPage
- GET    `/players/:id`          [BACKEND-ONLY] single-player read, never called
- PATCH  `/players/:id`          [DONE] PlayersRegistryPage rename
- DELETE `/players/:id`          [DONE] PlayersRegistryPage remove
- GET    `/players/:id/history`  [BACKEND-ONLY] assignment history, no UI

Roster assignments (`/teams`, auth)
- POST   `/teams/:id/assignments`             [DONE] roster assign
- PATCH  `/teams/:id/assignments/:playerId`   [DONE] change jersey
- DELETE `/teams/:id/assignments/:playerId`   [DONE] unassign
- GET    `/teams/:id/roster`                  [DONE] roster table

Batch upload (`/seasons`, Admin)
- POST `/seasons/:id/batch-upload`   [DONE] BatchUploadPage

Manual game scheduling (`/games`, Admin)
- POST  `/games`                 [BACKEND-ONLY] create a manual game, no UI
- PATCH `/games/:id`             [BACKEND-ONLY] reschedule a game, no UI
- POST  `/games/:id/cancel`      [BACKEND-ONLY] cancel a game, no UI

Automatic schedule generation (`/`, Admin)
- POST `/seasons/:id/schedule/generate`     [BACKEND-ONLY] generate draft, no UI
- POST `/seasons/:id/schedule/regenerate`   [BACKEND-ONLY] regenerate draft, no UI
- POST `/games/:id/assign`                  [BACKEND-ONLY] assign venue/time, no UI
- POST `/seasons/:id/schedule/submit`       [BACKEND-ONLY] submit draft, no UI

Scoring (`/games`, Admin)
- POST `/games/:id/score`           [BACKEND-ONLY] record score, no UI
- POST `/games/:id/score/correct`   [BACKEND-ONLY] correct score, no UI

Statistics (`/statistics`, Admin)
- POST `/statistics`             [BACKEND-ONLY] record a statistic, no UI

Awards (`/scopes`, Admin)
- POST `/scopes/:id/awards/compute`   [BACKEND-ONLY] compute awards, no UI
- POST `/scopes/:id/awards/publish`   [BACKEND-ONLY] publish awards, no UI

---

## 2. Missing from the BACKEND (route not exposed, though logic exists)

These are design-specified capabilities whose service logic exists but which
have no REST route, so no client can reach them.

B1. Statistics reads (Requirement 8.6-8.8).
    `StatisticsService.getPlayerSeasonStats` and `getTeamSeasonStats` are
    implemented and tested, but only `POST /statistics` is routed. There is no
    GET route for per-player or per-team season statistic totals. The design
    lists both reads under StatisticsService. Needs a read route, e.g.
    `GET /seasons/:seasonId/players/:playerId/statistics` and
    `GET /seasons/:seasonId/teams/:teamId/statistics`.

B2. Game / schedule reads for management (Requirement 5, 12).
    There is no authenticated route to list a Season's games (draft or
    official) for the management UI. The public schedule exists, but it only
    exposes official, non-cancelled games; an Administrator cannot read draft
    games, cancelled games, or a single game's full record over the API. Any
    scheduling, scoring, or statistics UI needs a management-side games list,
    e.g. `GET /seasons/:seasonId/games` and `GET /games/:gameId`.

B3. Awards read for management (Requirement 13).
    `AwardsService.computeAwards` returns a result and `publishAwards` returns
    the awards, but there is no authenticated GET to review already-computed
    (including unpublished) awards for a scope before publishing. The public
    route only returns published awards. Needs
    `GET /scopes/:scopeId/awards` (Admin) returning computed + publish state.

B4. Score read (Requirement 6).
    No route returns the stored Score for a game (the public results view is
    season-wide and read-only). A scoring/correction UI would benefit from
    `GET /games/:gameId/score`.

B5. User / role / team-manager administration (Requirements 1, 2, 4.4).
    The design describes Administrator, Team_Manager, and Viewer roles and
    `managedTeamIds` for Team_Managers, but there is no route to create users,
    assign roles, or assign managed teams. Only the seed script creates the
    admin user. Without this, Team_Manager and Viewer roles cannot be exercised
    through the running system.

B6. League creation (gap vs. data model).
    `leagueRepository.create` exists and the seed uses it, but there is no
    `POST /leagues`. Leagues can only be created by re-seeding. (Noted earlier;
    user chose to leave as-is, but recording it here for completeness.)

Note: These are the backend gaps. Everything else the design specifies for the
domain (standings, tiebreakers, round-robin generation, batch validation,
awards computation) is implemented and unit/property-tested.

---

## 3. Missing from the FRONTEND (backend route exists, no UI)

Grouped by feature area, in rough priority order.

F1. Regular-season game scheduling (manual) - Requirement 5.
    No UI for `POST /games`, `PATCH /games/:id`, `POST /games/:id/cancel`.
    An Administrator cannot create, reschedule, or cancel a regular-season game
    from the app. This is the most visible gap: the public Schedule page can
    only ever be empty because nothing creates official games.

F2. Automatic schedule generation (draft-then-submit) - Requirement 12.
    No UI for generate / regenerate / assign venue+time / submit. The whole
    draft-schedule workflow is unreachable. Depends on a management games-list
    read (B2) to show the generated draft before submitting.

F3. Score recording and correction - Requirement 6.
    No UI for `POST /games/:id/score` or `/score/correct`. Scores cannot be
    entered, so Results and Standings will always be empty. Depends on a games
    list (B2) to pick the game to score.

F4. Statistics recording and viewing - Requirement 8.
    No UI for `POST /statistics`, and the season-stat reads are not even routed
    (B1). No way to record points/assists/etc. or view player/team season
    totals.

F5. Awards computation and publication - Requirement 13.
    No UI for compute/publish. The public Awards page can only ever be empty
    because nothing computes or publishes awards. Depends on a management awards
    read (B3) to review before publishing.

F6. Player assignment history - Requirement 4.3.
    `GET /players/:id/history` has no UI. The PlayersRegistryPage could show a
    player's team/season/jersey history.

F7. User / role / team management - Requirements 1, 2, 4.4.
    No UI (and no backend, B5) to manage users, roles, or Team_Manager team
    assignments. Blocks any non-Administrator usage.

F8. Season / tournament / playoff READ depth.
    Current management pages create entities but do not always list what already
    exists in a reviewable way (e.g. the playoff games created, a season's full
    game list). Partly blocked on B2.

---

## 4. Dependency ordering (suggested build sequence)

1. B2 management games-list read  (unblocks F1, F2, F3, F5, F8)
2. F1 manual scheduling UX        (fastest path to a non-empty public Schedule)
3. F3 score recording UX          (fills Results + Standings)
4. F2 automatic schedule UX       (depends on B2)
5. B1 + F4 statistics             (route the reads, then build record/view UX)
6. B3 + F5 awards                 (route the admin read, then compute/publish UX)
7. F6 player history              (small, isolated)
8. B5 + F7 user/role management   (larger; unblocks Team_Manager/Viewer)
9. B6 league creation             (optional; user deferred)

---

## 5. Summary counts

Backend gaps (route not exposed): 6  (B1-B6)
Frontend gaps (UI not built):     8  (F1-F8)

Fully implemented end to end: Auth, public browsing (schedule/results/
standings/awards reads), leagues/seasons/teams/tournaments/playoffs management,
master players registry, roster assignment, and batch upload.

The dominant theme: the "game lifecycle" (schedule -> score -> standings ->
statistics -> awards) is almost entirely built on the backend domain layer but
has little or no HTTP surface and no UI. That is why the public Schedule,
Results, Standings, and Awards pages render empty - nothing in the running
system produces official games, scores, statistics, or awards yet.