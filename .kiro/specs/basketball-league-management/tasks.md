# Implementation Plan: Basketball League Management System

## Overview

Ang planong ito ay nagko-convert ng design tungo sa incremental, test-driven na coding steps para sa isang layered TypeScript web application (React frontend, Node.js/Express backend, PostgreSQL). Ang diskarte ay:

1. **Foundation muna**: project scaffolding, shared types, at error taxonomy.
2. **Pure domain core na may property-based tests**: Ito ang pinaka-error-prone na bahagi (standings ranking, round-robin generation, batch validation, statistics aggregation, series resolution, awards computation, session/lockout/authorize). Iniuuna ito at agad na sinasabayan ng `fast-check` property tests (Properties 1–38).
3. **Repository + Service layer**: nagko-connect ng pure domain sa persistence at transactions.
4. **API + Auth middleware**: HTTP transport at access control.
5. **Wiring at integration**: batch upload rollback, standings refresh, draft-then-submit, public endpoints.

Bawat property test ay tumatakbo ng minimum 100 iterations at tinatatakan ng:
`// Feature: basketball-league-management, Property {number}: {property_text}`

## Tasks

- [x] 1. Project scaffolding at shared foundation
  - Set up ang monorepo/workspace structure (backend `src/`, frontend `web/`), TypeScript config, at ESLint/Prettier
  - I-configure ang testing frameworks: Vitest/Jest para sa unit/integration at `fast-check` para sa property tests
  - I-set up ang PostgreSQL access layer (Prisma o Drizzle) at migration tooling
  - _Requirements: 8.1_

- [x] 2. Core domain types at error taxonomy
  - [x] 2.1 Define ang shared domain types at enums
    - Isulat ang TypeScript interfaces/types mula sa Data Models: `User`, `Session`, `League`, `Season`, `Tournament`, `Team`, `Player`, `Game`, `Score`, `Statistic`, `PlayoffRound`, `Series`, `StandingRow`, `Award`
    - Define ang enums: `StatisticType` (exactly 6 values), `TournamentFormat`, `PlayoffRoundType`, `BestOfN`, `GameStatus`, `ScheduleState`, `Role`, `AwardCategory`
    - _Requirements: 8.1, 9.5, 9.9_
  - [ ]* 2.2 Write unit tests for enum shape at type constraints
    - I-verify na ang `StatisticType` ay may eksaktong anim na values (Req 8.1); tournament formats at playoff rounds enumerations (Req 9.5, 9.9)
    - _Requirements: 8.1, 9.5, 9.9_
  - [x] 2.3 Implement ang error taxonomy
    - Isulat ang structured error classes/shape `{ error: { category, message, details? } }`: `ValidationError`, `AuthenticationError`, `AccountLockedError`, `AuthorizationError`, `NotFoundError`, `ConflictError`, `ConstraintError`, `CapacityError`, `BatchValidationError`
    - _Requirements: 2.2, 2.3, 3.2, 5.5, 11.3, 12.18_

- [x] 3. Pure domain: Authentication at Authorization logic
  - [x] 3.1 Implement ang pure `sessionState` at `lockoutState` functions
    - `sessionState(session, now)` → active iff elapsed since `lastActivityAt` < 30 min at hindi signed out (sliding expiry)
    - `lockoutState(failedAttempts, now)` → locked iff >5 failures sa nakaraang 15-min rolling window
    - `verifyCredentials` result shape na hindi nagdi-disclose kung username o password ang mali
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6_
  - [ ]* 3.2 Write property test para sa valid sign-in session scoping
    - **Property 1: Valid sign-in yields a session scoped to the user's role**
    - **Validates: Requirements 1.1**
  - [ ]* 3.3 Write property test para sa 30-minute inactivity rule
    - **Property 2: Session validity follows the 30-minute inactivity rule**
    - **Validates: Requirements 1.2, 1.5**
  - [ ]* 3.4 Write property test para sa non-disclosure ng invalid credentials
    - **Property 3: Invalid credentials are rejected without disclosure**
    - **Validates: Requirements 1.3, 1.4**
  - [ ]* 3.5 Write property test para sa rolling-window lockout
    - **Property 4: Account lockout obeys the rolling-window rule**
    - **Validates: Requirements 1.6**
  - [x] 3.6 Implement ang pure `authorize` function
    - Allow iff Administrator, o Team_Manager na kumikilos sa managed Team; deny ang Viewer at no-role; deny na hindi binabago ang target
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 4.4, 12.1_
  - [ ]* 3.7 Write property test para sa role at team-scope authorization
    - **Property 5: Authorization respects role and team scope**
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 4.4, 12.1**

- [x] 4. Pure domain: Standings ranking
  - [x] 4.1 Implement ang pure `rankTeams` comparator
    - Deterministic ordering: wins desc → losses asc → head-to-head wins among tied → Points_Ratio desc (zero points allowed = highest) → team name asc; identical teams = same rank
    - I-compute ang Points_Ratio mula sa Game Scores, hindi mula sa per-Player "Points" statistic
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_
  - [ ]* 4.2 Write property test para sa full standings comparator
    - **Property 15: Standings ranking is total and follows the full comparator**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7**
  - [ ]* 4.3 Write property test para sa standings row fields
    - **Property 16: Standings rows expose wins, losses, and rank**
    - **Validates: Requirements 7.8, 10.4**

- [x] 5. Pure domain: Statistics aggregation
  - [x] 5.1 Implement ang pure `aggregateStatistics` function
    - Player season total per Statistic_Type = sum ng player's values (zero kung wala); team total = sum ng players' totals
    - I-validate ang value bounds (0–999 integer), enum type, at player eligibility (nasa participating Team)
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_
  - [ ]* 5.2 Write property test para sa statistic store round-trip at eligibility
    - **Property 18: Statistic store round-trip and eligibility**
    - **Validates: Requirements 8.2, 8.3, 8.4, 8.5**
  - [ ]* 5.3 Write property test para sa statistic aggregation sum
    - **Property 19: Statistic aggregation equals the sum of contributions**
    - **Validates: Requirements 8.6, 8.7, 8.8**

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Pure domain: Series resolution
  - [x] 7.1 Implement ang pure `resolveSeries` function
    - I-validate na best-of-N ∈ {1,3,5,7}; winner = unang Team na aabot ng >N/2 game wins; walang winner bago maabot ang majority
    - _Requirements: 9.10, 9.11, 9.12_
  - [ ]* 7.2 Write property test para sa best-of-N validation at majority winner
    - **Property 22: Series best-of-N validation and majority winner**
    - **Validates: Requirements 9.10, 9.11, 9.12**

- [x] 8. Pure domain: Venue conflict detection
  - [x] 8.1 Implement ang pure `detectVenueConflict` function
    - Conflict iff ang candidate interval [start, start+duration) ay nag-o-overlap sa isang existing non-cancelled Game sa parehong Venue
    - _Requirements: 5.5_
  - [ ]* 8.2 Write property test para sa venue interval overlap
    - **Property 11: Venue conflict detection is exactly interval overlap**
    - **Validates: Requirements 5.5**

- [x] 9. Pure domain: Batch validation
  - [x] 9.1 Implement ang pure `validateBatch` function
    - I-classify ang row bilang invalid iff may missing required field, name length outside 1–100, duplicate jersey sa loob ng Team, o malformed data
    - I-produce ang all-or-nothing decision + per-row report na nagnga-name ng bawat invalid row at reason
    - _Requirements: 11.2, 11.3, 11.4_
  - [ ]* 9.2 Write property test para sa all-or-nothing at per-row reporting
    - **Property 26: Batch upload is all-or-nothing with per-row reporting**
    - **Validates: Requirements 11.2, 11.3**
  - [ ]* 9.3 Write property test para sa row validity classification
    - **Property 27: Row validity classification**
    - **Validates: Requirements 11.4**

- [x] 10. Pure domain: Round-robin schedule generation
  - [x] 10.1 Implement ang pure `roundRobinPairings` function
    - Para sa n ≥ 2 Teams at kind k (1 single, 2 double): bawat unordered pair ng distinct Teams ay lalabas ng eksaktong k beses, kabuuang k·n·(n−1)/2 Games
    - _Requirements: 12.7, 12.8_
  - [ ]* 10.2 Write property test para sa exact at complete pairings
    - **Property 28: Round-robin pairings are exact and complete**
    - **Validates: Requirements 12.7, 12.8**
  - [x] 10.3 Implement ang pure `distributeGames` function
    - I-place ang matchups sa mga valid date (nasa range at napiling Playable_Day) na walang start time/Venue; balanced per-team counts (min achievable difference); respetuhin ang per-day capacity; i-detect ang insufficient capacity at i-report ang hindi na-place na matchups
    - _Requirements: 12.9, 12.10, 12.12, 12.14, 12.18_
  - [ ]* 10.4 Write property test para sa date range, playable days, at unassigned slots
    - **Property 29: Generated Games respect date range, playable days, and unassigned slots**
    - **Validates: Requirements 12.9, 12.10**
  - [ ]* 10.5 Write property test para sa minimally imbalanced per-team counts
    - **Property 30: Per-team game counts are minimally imbalanced**
    - **Validates: Requirements 12.12**
  - [ ]* 10.6 Write property test para sa per-day capacity
    - **Property 31: Per-day capacity is respected**
    - **Validates: Requirements 12.14**
  - [ ]* 10.7 Write property test para sa insufficient capacity detection
    - **Property 33: Insufficient capacity is detected and reported**
    - **Validates: Requirements 12.18**

- [x] 11. Pure domain: Awards computation
  - [x] 11.1 Implement ang regular-season awards computation (`computeRegularSeasonAwards`)
    - Gamitin lamang ang regular-season Statistics (exclude playoff); single-winner argmax na may tiebreak (higher total Points, then ascending name); Mythical 5 = top five by Combined_Statistic_Total desc na may parehong tiebreak sa fifth-position boundary
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8_
  - [ ]* 11.2 Write property test para sa regular-season-only inputs
    - **Property 34: Regular-season awards use regular-season Statistics only**
    - **Validates: Requirements 13.1**
  - [ ]* 11.3 Write property test para sa single-winner stat awards argmax
    - **Property 35: Single-winner stat awards select the metric argmax with deterministic tiebreak**
    - **Validates: Requirements 13.2, 13.4, 13.5, 13.6, 13.7**
  - [ ]* 11.4 Write property test para sa Mythical 5 selection
    - **Property 36: Mythical 5 selects the top five by Combined_Statistic_Total**
    - **Validates: Requirements 13.3, 13.8**
  - [x] 11.5 Implement ang Finals MVP computation (`computeFinalsMvp`)
    - I-restrict ang pool sa champion Team; maximize Finals TSP; tiebreak: full-playoffs TSP → higher total playoff Points → ascending name; deterministic
    - _Requirements: 13.9, 13.10, 13.11_
  - [ ]* 11.6 Write property test para sa Finals MVP selection
    - **Property 37: Finals MVP selects the champion-team leader in Finals TSP**
    - **Validates: Requirements 13.9, 13.10, 13.11**

- [x] 12. Checkpoint - Ensure all pure domain tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Repository layer
  - [x] 13.1 Define ang database schema at migrations
    - Isulat ang relational schema (foreign keys: League→Season→Team→Player→Game→Statistic; Score, PlayoffRound, Series, User, Award) na tumutugma sa Data Models
    - _Requirements: 3.1, 4.1, 5.1, 8.2, 9.1_
  - [x] 13.2 Implement ang repositories na may transactional support
    - CRUD repositories para sa bawat entity; single-transaction (all-or-nothing) na operation para sa batch import at sa multi-write use cases
    - _Requirements: 3.7, 6.1, 11.3_

- [x] 14. Teams at Rosters services
  - [x] 14.1 Implement ang TeamService
    - `createTeam`/`updateTeam`/`deleteTeam` na may name-length (1–100), season existence, case-insensitive duplicate check; iwasan ang delete kapag may ≥1 completed Games
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_
  - [ ]* 14.2 Write property test para sa team creation validation
    - **Property 6: Team creation validation and association**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
  - [ ]* 14.3 Write property test para sa team deletion gating
    - **Property 7: Team deletion is gated by completed Games**
    - **Validates: Requirements 3.7, 3.8**
  - [x] 14.4 Implement ang PlayerService/RosterService
    - `addPlayer`/`updatePlayer`/`removePlayer` na may name (1–100), jersey (0–99), jersey uniqueness sa roster, at team-scoped authorization
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 4.7_
  - [ ]* 14.5 Write property test para sa roster add/remove round-trip
    - **Property 8: Roster add/remove round-trip**
    - **Validates: Requirements 4.1, 4.5**
  - [ ]* 14.6 Write property test para sa roster validation
    - **Property 9: Roster validation rejects invalid or duplicate Players**
    - **Validates: Requirements 4.2, 4.3, 4.7**

- [x] 15. Scheduling at Scoring services
  - [x] 15.1 Implement ang manual SchedulingService
    - `createGame`/`rescheduleGame`/`cancelGame` na tumatawag sa `detectVenueConflict`; distinct teams, future-date, duration 1–480, Venue present; cancelled Game hindi ma-reschedule
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 5.8_
  - [ ]* 15.2 Write property test para sa manual game creation validation
    - **Property 10: Manual Game creation validation**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
  - [ ]* 15.3 Write property test para sa reschedule at cancel state rules
    - **Property 12: Reschedule and cancel state rules**
    - **Validates: Requirements 5.6, 5.7, 5.8**
  - [x] 15.4 Implement ang ScoringService
    - `recordScore` (mark completed, i-validate 0–999 integer) at `correctScore` (para sa completed games); i-trigger ang standings recalculation
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [ ]* 15.5 Write property test para sa score recording completion
    - **Property 13: Score recording marks completion and validates values**
    - **Validates: Requirements 6.1, 6.2**
  - [ ]* 15.6 Write property test para sa completed-game correction rule
    - **Property 14: Completed-Game score correction rule**
    - **Validates: Requirements 6.4, 6.5**

- [x] 16. Standings, Statistics, at Season/Tournament services
  - [x] 16.1 Implement ang StandingsService
    - `computeStandings(seasonId)` tumatawag sa `rankTeams`; i-store ang final snapshot kapag closed at ibalik ito nang hindi nagbabago pagkatapos
    - _Requirements: 7.8, 7.9, 10.4, 10.5_
  - [ ]* 16.2 Write property test para sa closed-season snapshot
    - **Property 17: Closed-Season Standings return the recorded snapshot**
    - **Validates: Requirements 10.5**
  - [x] 16.3 Implement ang StatisticsService
    - `recordStatistic`, `getPlayerSeasonStats`, `getTeamSeasonStats` na tumatawag sa `aggregateStatistics`; 6-type enum, 0–999, eligibility enforcement
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_
  - [x] 16.4 Implement ang SeasonTournamentService
    - `createSeason`/`createTournament`/`createPlayoffGame`/`createSeries`/`closeSeason`; date ordering, format at best-of-N validation, game classification, closed-season game rejection
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.13_
  - [ ]* 16.5 Write property test para sa season creation validation
    - **Property 20: Season creation validation**
    - **Validates: Requirements 9.1, 9.2, 9.3**
  - [ ]* 16.6 Write property test para sa game classification invariant
    - **Property 21: Game classification invariant**
    - **Validates: Requirements 9.8**
  - [ ]* 16.7 Write property test para sa closed-season game rejection
    - **Property 23: Closed Season rejects new Games**
    - **Validates: Requirements 9.13**

- [x] 17. Checkpoint - Ensure all service tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. Batch upload, automatic scheduling, at Awards services
  - [x] 18.1 Implement ang BatchUploadService
    - I-parse ang CSV/.xlsx (reject ibang format at empty file), tumawag sa `validateBatch`, at mag-import sa loob ng single all-or-nothing transaction
    - _Requirements: 11.1, 11.2, 11.3, 11.5, 11.6_
  - [ ]* 18.2 Write unit tests para sa file-format acceptance at empty file
    - I-test na CSV at .xlsx ay tinatanggap, ibang format at empty file ay tinatanggihan (Req 11.1, 11.5, 11.6)
    - _Requirements: 11.1, 11.5, 11.6_
  - [x] 18.3 Implement ang automatic SchedulingService (draft)
    - `generateSchedule` (draft, tumatawag sa `roundRobinPairings` at `distributeGames`), `regenerateSchedule`, `assignVenueAndTime`, `submitDraftSchedule`; validation ng generation inputs at Admin-only authorization
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.11, 12.15, 12.16, 12.17_
  - [ ]* 18.4 Write unit tests para sa generation input validation
    - I-test ang end < start, walang playable day, games/day < 1, fewer than two Teams (Req 12.3–12.6)
    - _Requirements: 12.3, 12.4, 12.5, 12.6_
  - [ ]* 18.5 Write property test para sa draft-then-submit visibility
    - **Property 32: Draft-then-submit visibility round-trip**
    - **Validates: Requirements 12.15, 12.17**
  - [x] 18.6 Implement ang AwardsService
    - `computeAwards` (tumatawag sa `computeRegularSeasonAwards` at `computeFinalsMvp`), `publishAwards`, `getPublishedAwards`; hidden hanggang published; no-finals at no-stats indications
    - _Requirements: 13.12, 13.13, 13.14, 13.15, 13.16_
  - [ ]* 18.7 Write property test para sa published-awards visibility
    - **Property 38: Viewers see exactly the published Awards**
    - **Validates: Requirements 13.13, 13.14, 13.15**

- [x] 19. Auth middleware at API layer
  - [x] 19.1 Implement ang Authentication + Authorization middleware
    - I-verify ang session (sliding expiry) at i-enforce ang role/team access bago maabot ang service; i-map ang failures sa 401/403/423
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5_
  - [ ]* 19.2 Write unit tests para sa single primary role at no-role deny
    - I-test ang single primary role assignment (Req 2.1) at deny-all kapag walang role
    - _Requirements: 2.1, 2.5_
  - [x] 19.3 Implement ang REST controllers para sa mutating endpoints
    - Routes para sa teams, players, games, scores, statistics, seasons/tournaments, batch upload, schedule generation, awards; request parsing, response serialization, error-to-status mapping
    - _Requirements: 3.1, 4.1, 5.1, 6.1, 8.2, 9.1, 11.2, 12.2, 13.13_
  - [x] 19.4 Implement ang public browsing endpoints
    - Read-only schedule, results, at standings na hindi nangangailangan ng sign-in; schedule ordered by date/time na may required fields; results na may scores at completion date; empty-result informational payloads
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_
  - [ ]* 19.5 Write property test para sa schedule ordering at required fields
    - **Property 24: Schedule ordering and required fields**
    - **Validates: Requirements 10.1**
  - [ ]* 19.6 Write property test para sa results scores at completion date
    - **Property 25: Results expose scores and completion date**
    - **Validates: Requirements 10.3**

- [x] 20. Frontend wiring
  - [x] 20.1 Implement ang React SPA na kumokonsumo ng REST API
    - Auth flows (sign-in/out), Admin/Team_Manager management views, at public browsing views (schedule, results, standings, published awards) na accessibility-compliant
    - _Requirements: 1.1, 3.1, 4.1, 10.1, 10.6, 13.15_

- [ ] 21. Integration at end-to-end wiring
  - [ ]* 21.1 Write integration test para sa score → standings refresh
    - I-verify na ang score recording ay nagre-refresh ng standings na nakikita sa public standings endpoint (Req 6.3)
    - _Requirements: 6.3_
  - [ ]* 21.2 Write integration test para sa auth flow at session timing
    - End-to-end sign-in, session timeout, lockout, sign-out laban sa totoong session store (Req 1.1, 1.5)
    - _Requirements: 1.1, 1.5, 1.6_
  - [ ]* 21.3 Write integration test para sa batch upload rollback
    - I-confirm ang all-or-nothing rollback laban sa totoong transactional database (Req 11.3)
    - _Requirements: 11.3_
  - [ ]* 21.4 Write integration test para sa draft-to-public schedule flow
    - Generate draft → assign venue/time → submit → public visibility end to end (Req 12.11, 12.16, 12.17)
    - _Requirements: 12.11, 12.16, 12.17_

- [x] 22. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Ang mga task na may `*` ay optional (test-related) at pwedeng laktawan para sa mas mabilis na MVP, pero inirerekomenda para sa correctness.
- Bawat task ay nagre-reference ng specific requirements at/o correctness properties para sa traceability.
- Ang mga pure domain function (Tasks 3–11) ay iniuna dahil sila ang property-tested na core; ini-implement bago ang services na gumagamit sa kanila.
- Ang mga checkpoint ay nagbibigay ng incremental validation points.
- Property tests ay tumatakbo ng minimum 100 iterations gamit ang `fast-check`; unit at integration tests ay para sa specific scenarios, wiring, at timing.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["2.2", "2.3", "3.1", "3.6", "4.1", "5.1", "7.1", "8.1", "9.1", "10.1", "10.3", "11.1", "11.5"] },
    { "id": 2, "tasks": ["3.2", "3.3", "3.4", "3.5", "3.7", "4.2", "4.3", "5.2", "5.3", "7.2", "8.2", "9.2", "9.3", "10.2", "10.4", "10.5", "10.6", "10.7", "11.2", "11.3", "11.4", "11.6", "13.1"] },
    { "id": 3, "tasks": ["13.2", "14.1", "14.4", "16.4"] },
    { "id": 4, "tasks": ["14.2", "14.3", "14.5", "14.6", "15.1", "15.4", "16.1", "16.3", "16.5", "16.6", "16.7", "18.1", "18.3", "18.6"] },
    { "id": 5, "tasks": ["15.2", "15.3", "15.5", "15.6", "16.2", "18.2", "18.4", "18.5", "18.7", "19.1", "19.3", "19.4"] },
    { "id": 6, "tasks": ["19.2", "19.5", "19.6", "20.1"] },
    { "id": 7, "tasks": ["21.1", "21.2", "21.3", "21.4"] }
  ]
}
```
