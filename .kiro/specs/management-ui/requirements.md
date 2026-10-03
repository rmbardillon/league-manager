# Requirements Document

## Introduction

The Basketball League Management System already implements its full backend (Express 5 + TypeScript + Drizzle over PostgreSQL, layered routes → services → repositories → domain) and a React SPA. However, the management UI shipped as a thin demo and has several usability gaps that make the application impractical to operate:

- There is no Season creation or management UI, even though the backend exposes Season, Tournament, Playoff_Round, Series, and close endpoints.
- Selecting a Season or a Team is done through free-text UUID inputs — operators are expected to paste identifiers by hand. This is the central usability defect.
- The Team and Roster management pages only track records created during the current browser session in local React state. There are no list/read views, so a page refresh loses the on-screen list even though the data remains in the database.
- The backend exposes no authenticated list-read endpoints for leagues, seasons, teams, or tournaments. Only unauthenticated public read endpoints (schedule, results, standings, awards) and mutating endpoints exist. The repositories already provide the needed list methods (`leagueRepository.list`, `seasonRepository.listByLeague`, `teamRepository.listBySeason`, `tournamentRepository.listBySeason`), so the gap for those is only at the route layer. The authenticated reads needed for the Roster view — the master-Player list (`GET /players`) and the Team Roster (`GET /teams/:teamId/roster`) — were delivered by the `player-master-data` spec and already exist; this spec consumes them rather than defining them.

This spec defines the requirements to close the management-UI gap. It adds the authenticated list-read endpoints needed to populate selectors and list views, rebuilds the management UI around human-readable dropdown selectors instead of raw identifier entry, adds a Season management UI, makes list views load from the API so they survive refresh, and adopts **Mantine** (`@mantine/core`, `@mantine/hooks`, and `@mantine/form` / `@mantine/notifications` as appropriate) as the UI component library for consistent, accessible components (Select, Table, forms with inline validation, modals, and toast notifications).

This document is self-contained. Where a rule originates in the base spec (`.kiro/specs/basketball-league-management`), it is referenced as "base Requirement N" for traceability, but all acceptance criteria needed for review appear here.

### Constraints honored (not re-litigated)

- **Backend architecture**: Express 5 + TypeScript (NodeNext/ESM), Drizzle over PostgreSQL, layered architecture, the structured error envelope `{ error: { category, message, details? } }` mapped to HTTP status by the central error handler, session-cookie authentication with the `authenticate` and `authorizeRequest` middleware, and the role model (Administrator / Team_Manager / Viewer) with team-scoped authorization for Team_Manager (base Requirement 2).
- **Frontend architecture**: React 18 + TypeScript + Vite, react-router-dom, the existing `AuthContext` / `AuthProvider` (`signIn`, `signOut`, `isAdmin`, `isTeamManager`, `canManageTeam`), the typed API client under `web/src/api` that sends `credentials: 'include'` and maps the error envelope to `ApiError`, and the Vite dev proxy that forwards API prefixes to the backend.
- **Entity model and validation bounds**: League → Season → Team, plus Tournament, Playoff_Round, Series, Game. A **master Player** (`{ id, name }`) is a person with a name of 1–100 characters that is NOT globally unique and is decoupled from any Team or jersey. A **Roster_Assignment** (`{ id, playerId, teamId, jerseyNumber }`) links a master Player to a Team (and thus to that Team's Season) with a jersey number of 0–99 that is unique within the Team's Roster; a Player holds at most one Roster_Assignment per Season. Season name is 1–100 characters with an end date strictly after the start date and a `closed` flag; Team name is 1–100 characters and unique case-insensitively within a Season. (This master/assignment split is defined and implemented by the `player-master-data` spec; this spec builds its Roster UI on top of it.)

### Out of scope (this spec)

The following are explicitly out of scope and are candidates for later specs. They are called out so reviewers can confirm the scope boundary:

- **League creation UI** — Leagues are read (for the League selector) but not created or edited through this UI. League seeding continues via existing means (seed/API).
- **Game scheduling and automatic schedule generation UI** — no regular-season scheduling, draft-schedule, rescheduling, or generation UI is added here. Playoff Game creation (associating a Game with a Playoff_Round and optional Series) is in scope per Requirement 8.4; general regular-season scheduling is not.
- **Score recording, statistics entry, awards computation/publishing UI** — unchanged by this spec.
- **User account management UI** — creating users and assigning roles/managed teams is not part of this spec.

## Glossary

- **System**: The Basketball League Management web application as a whole, comprising the backend API and the React SPA.
- **Management_UI**: The authenticated portion of the React SPA used by Administrators and Team_Managers to manage Seasons, Teams, and Rosters.
- **Public_UI**: The unauthenticated browsing portion of the SPA (schedule, results, standings, awards).
- **Administrator**: A user with full create/read/update/delete access (base Requirement 2.4).
- **Team_Manager**: A user assigned to one or more Teams who may manage those Teams' rosters and act on those Teams (base Requirement 2.2, 4.4).
- **Viewer**: An unauthenticated or authenticated user with no modification rights.
- **List_Endpoint**: An authenticated backend GET endpoint that returns a collection of entities (Leagues, Seasons, Teams, Tournaments, master Players, or a Team's Roster) for populating selectors and list views.
- **Selector**: A Mantine `Select` (or equivalent) control that presents entities by human-readable name and resolves the chosen entity to its identifier internally, so the user never types or reads a raw identifier.
- **League_Selector**: A Selector listing Leagues by name.
- **Season_Selector**: A Selector listing Seasons (of a chosen League, or across accessible Leagues) by name.
- **Team_Selector**: A Selector listing Teams (of a chosen Season) by name.
- **Player_Selector**: A Selector listing master Players by name, populated from the master-Player List_Endpoint, used to choose an existing person to assign to a Team's Roster.
- **Identifier**: The opaque UUID that uniquely identifies an entity; used internally by the client and API, never presented for manual entry in normal flows.
- **Notification**: A transient, accessible Mantine notification (toast) conveying success or failure of an operation, replacing `window.alert`, `window.prompt`, and `window.confirm`.
- **Component_Library**: Mantine (`@mantine/core`, `@mantine/hooks`, `@mantine/form`, `@mantine/notifications`), adopted as the SPA's UI component library.
- **League**: A named competition grouping one or more Seasons.
- **Season**: A time-bounded period within a League containing Teams; has a name, a start date, an end date after the start date, and a `closed` flag.
- **Team**: A named competitor participating in exactly one Season; its Roster is the set of master Players assigned to it.
- **Player** (also **Master_Player**): A person, identified by an identifier and a name of 1–100 characters. A master Player carries no Team and no jersey number, and names are NOT globally unique. (Defined by the `player-master-data` spec.)
- **Roster_Assignment**: A record linking one master Player to one Team (and thus one Season) with a Jersey_Number. Created by "assigning" an existing master Player to a Team; removed by "unassigning".
- **Jersey_Number**: An integer in the range 0–99, a property of a Roster_Assignment, unique within a Team's Roster.
- **Roster**: The set of master Players currently assigned to a Team via Roster_Assignments, each presented with the Player's name and Jersey_Number for that Team.
- **Tournament**: A structured competition within a Season, with a format of single-elimination, double-elimination, or round-robin; a round-robin Tournament additionally specifies a single or double kind.
- **Tournament_Format**: One of single-elimination, double-elimination, or round-robin.
- **Playoff_Round**: A stage of playoff competition within a Season, identified by a type of Quarterfinals, Semifinals, or Finals.
- **Playoff_Round_Type**: One of Quarterfinals, Semifinals, or Finals.
- **Series**: A best-of-N matchup between two distinct Teams within a Playoff_Round, where N is 1, 3, 5, or 7.
- **Playoff_Game**: A Game associated with exactly one Playoff_Round and, optionally, one Series.

## Requirements

### Requirement 1: Authenticated List-Read Endpoints for Leagues and Seasons

**User Story:** As an Administrator, I want authenticated endpoints that list Leagues and their Seasons, so that the Management_UI can populate League and Season selectors from real data instead of requiring manual identifier entry.

#### Acceptance Criteria

1. WHEN an authenticated Administrator requests the list of Leagues, THE System SHALL return the collection of Leagues, each entry including its Identifier and name.
2. WHEN an authenticated Administrator requests the list of Seasons for a specified League, THE System SHALL return the collection of Seasons associated with that League, each entry including its Identifier, name, start date, end date, and closed flag.
3. IF an authenticated User requests the list of Seasons for a League that does not exist, THEN THE System SHALL return an error indicating the League was not found using the standard error envelope, and SHALL return no Season collection.
4. WHERE a requested League has no associated Seasons, THE System SHALL return an empty Season collection without returning an error.
5. WHERE the System contains no Leagues, THE System SHALL return an empty League collection without returning an error.
6. IF an unauthenticated User requests any List_Endpoint for Leagues or Seasons, THEN THE System SHALL reject the request with an authentication error using the standard error envelope, and SHALL return no collection.
7. IF a User whose primary role is Viewer requests any authenticated List_Endpoint for Leagues or Seasons, THEN THE System SHALL reject the request with an authorization error using the standard error envelope, and SHALL return no collection.
8. THE authenticated Leagues and Seasons List_Endpoints defined in this requirement SHALL be distinct from the unauthenticated public Seasons List_Endpoint defined in Requirement 7, so that management enumeration and public browsing enumeration remain separately governed.

### Requirement 2: Authenticated List-Read Endpoints for Teams, Tournaments, Master Players, and Rosters

**User Story:** As an Administrator or Team_Manager, I want authenticated endpoints that list Teams of a Season and Tournaments of a Season (to be added by this spec), plus the master-Player list and a Team's Roster (already provided by the `player-master-data` spec), so that the Management_UI can populate selectors and list views that survive a page refresh.

#### Acceptance Criteria

1. WHEN an authenticated Administrator requests the list of Teams for a specified Season, THE System SHALL return the collection of Teams associated with that Season, each entry including its Identifier and name.
2. WHEN an authenticated Administrator requests the list of Tournaments for a specified Season, THE System SHALL return the collection of Tournaments associated with that Season, each entry including its Identifier and format.
3. WHEN an authenticated Administrator requests the list of master Players, THE System SHALL return the collection of master Players, each entry including its Identifier and name, using the existing `GET /players` endpoint provided by the `player-master-data` spec.
4. WHEN an authorized User requests a specified Team's Roster, THE System SHALL return the collection of Roster_Assignments for that Team, each entry including the assigned Player's Identifier, name, and jersey number, using the existing `GET /teams/:teamId/roster` endpoint provided by the `player-master-data` spec.
5. WHERE an authenticated Team_Manager requests the Roster of a Team assigned to that Team_Manager, THE System SHALL return that Team's Roster; an Administrator SHALL be authorized for any Team's Roster.
6. IF a Team_Manager requests the Roster of a Team that is not assigned to that Team_Manager, THEN THE System SHALL reject the request with an authorization error using the standard error envelope, and SHALL return no Roster collection.
7. IF an authenticated User requests the list of Teams or Tournaments for a Season that does not exist, THEN THE System SHALL return an error indicating the Season was not found using the standard error envelope, and SHALL return no collection.
8. WHERE a specified Season has no Teams or no Tournaments, or a specified Team has an empty Roster, THE System SHALL return an empty collection without returning an error.
9. IF an unauthenticated User requests any List_Endpoint for Teams or Tournaments, THEN THE System SHALL reject the request with an authentication error using the standard error envelope, and SHALL return no collection.

### Requirement 3: League, Season, and Team Selectors Replace Identifier Entry

**User Story:** As an operator of the Management_UI, I want to choose a League, Season, or Team from named dropdowns, so that I never have to read, remember, or paste a raw identifier.

#### Acceptance Criteria

1. THE Management_UI SHALL present League, Season, and Team choices exclusively through named Selectors populated from the List_Endpoints, and SHALL NOT require the User to type an Identifier in any normal management flow.
2. WHEN a User opens a management view that requires a League, THE Management_UI SHALL load the available Leagues and present them in a League_Selector labeled by League name.
3. WHEN a User selects a League in a League_Selector, THE Management_UI SHALL load the Seasons of that League and present them in a Season_Selector labeled by Season name.
4. WHEN a User selects a Season in a Season_Selector, THE Management_UI SHALL load the Teams of that Season and present them in a Team_Selector labeled by Team name.
5. WHEN a User selects an entry in any Selector, THE Management_UI SHALL resolve the selection to that entity's Identifier internally and use that Identifier for subsequent API requests.
6. WHILE a Selector's options are being loaded from a List_Endpoint, THE Management_UI SHALL indicate the loading state and SHALL prevent selection of options that are not yet loaded.
7. WHERE a List_Endpoint returns an empty collection for a Selector, THE Management_UI SHALL display an accessible empty-state message within that Selector's context and SHALL NOT present a free-text Identifier fallback.
8. IF a List_Endpoint request for a Selector fails, THEN THE Management_UI SHALL display an accessible error message and SHALL allow the User to retry loading that Selector.
9. WHEN a User assigns a Player to a Team in the Roster view, THE Management_UI SHALL present the choice of master Player through a Player_Selector populated from `GET /players` and labeled by Player name, resolving the selection to the Player's Identifier internally, and SHALL NOT require the User to type a Player Identifier.

### Requirement 4: Season Management UI

**User Story:** As an Administrator, I want to create, list, and close Seasons within a League from the Management_UI, so that I can organize competitions over time without using raw endpoints.

#### Acceptance Criteria

1. WHEN an Administrator opens the Season management view, THE Management_UI SHALL present a League_Selector and, after a League is selected, SHALL display the list of that League's Seasons loaded from the List_Endpoint, showing each Season's name, start date, end date, and closed status.
2. WHEN an Administrator submits a new Season with a selected League, a name of 1 to 100 characters, a start date, and an end date after the start date, THE System SHALL create the Season and THE Management_UI SHALL display the created Season in the Season list and show a success Notification.
3. IF an Administrator submits a new Season whose end date is the same as or precedes its start date, THEN THE Management_UI SHALL surface a validation message indicating the end date must be after the start date, and THE System SHALL create no Season.
4. IF an Administrator submits a new Season with a name that is empty, exceeds 100 characters, or duplicates an existing Season name within the selected League, THEN THE Management_UI SHALL surface the validation error returned by the System, and THE System SHALL create no Season.
5. WHEN an Administrator confirms closing an open Season, THE System SHALL mark the Season as closed and THE Management_UI SHALL reflect the closed status in the Season list and show a success Notification.
6. WHILE a Season is displayed as closed, THE Management_UI SHALL present the close action as unavailable for that Season.
7. WHERE the selected League has no Seasons, THE Management_UI SHALL display an accessible empty-state message inviting the Administrator to create the first Season.
8. IF a Season create or close request fails, THEN THE Management_UI SHALL display an accessible error Notification conveying the failure reason from the error envelope, and SHALL leave the displayed Season list unchanged.

### Requirement 5: Team Management UI Backed by the List Endpoint

**User Story:** As an Administrator, I want to pick a Season and see the real list of its Teams, so that I can create, rename, and delete Teams with the list surviving a page refresh.

#### Acceptance Criteria

1. WHEN an Administrator opens the Team management view and selects a Season, THE Management_UI SHALL load the Teams of that Season from the List_Endpoint and display them by name.
2. WHEN an Administrator reloads the Team management view for a previously selected Season, THE Management_UI SHALL display the Teams currently persisted for that Season, independent of any prior browser session state.
3. WHEN an Administrator submits a new Team with a selected Season and a name of 1 to 100 characters that does not duplicate an existing Team name within that Season, THE System SHALL create the Team and THE Management_UI SHALL add it to the displayed list and show a success Notification.
4. IF an Administrator submits a Team name that is empty, exceeds 100 characters, or duplicates an existing Team name within the Season using case-insensitive comparison, THEN THE Management_UI SHALL surface the validation error returned by the System, and THE System SHALL create no Team.
5. WHEN an Administrator renames an existing Team to a name of 1 to 100 characters that does not duplicate another Team in the same Season, THE System SHALL save the new name and THE Management_UI SHALL display the updated name and show a success Notification.
6. WHEN an Administrator confirms deletion of a Team through an accessible confirmation dialog and that Team has no completed Games, THE System SHALL delete the Team and THE Management_UI SHALL remove it from the displayed list and show a success Notification.
7. IF an Administrator confirms deletion of a Team that has one or more completed Games, THEN THE System SHALL reject the deletion and THE Management_UI SHALL display an accessible error Notification indicating the Team has completed Games, and SHALL retain the Team in the displayed list.
8. WHERE the selected Season has no Teams, THE Management_UI SHALL display an accessible empty-state message inviting the Administrator to create the first Team.

### Requirement 6: Roster Management UI Backed by the Roster and Master-Player Endpoints

**User Story:** As an Administrator or Team_Manager, I want to pick a Season then a Team and see that Team's real Roster, so that I can assign existing master Players to the Team, change their jersey numbers, and unassign them — with the list surviving a page refresh and with my authorization respected.

#### Acceptance Criteria

1. WHEN a User opens the Roster management view, THE Management_UI SHALL present a Season_Selector and a Team_Selector, and after a Team is selected SHALL load that Team's Roster from `GET /teams/:teamId/roster` and display each entry by the assigned Player's name and jersey number.
2. WHEN a User reloads the Roster management view for a previously selected Team, THE Management_UI SHALL display the Roster currently persisted for that Team, independent of any prior browser session state.
3. WHERE the authenticated User is a Team_Manager and the selected Team is not assigned to that Team_Manager, THE Management_UI SHALL present the assign, change-jersey, unassign, and new-player controls as unavailable and SHALL display an accessible notice explaining the User is not authorized for that Team.
4. WHEN an authorized User assigns a Player by choosing an existing master Player from a Player_Selector and entering a jersey number of 0 to 99 not already used on the Team's Roster, THE System SHALL create a Roster_Assignment via `POST /teams/:teamId/assignments` and THE Management_UI SHALL display the assigned Player in the Roster and show a success Notification.
5. WHERE no suitable master Player exists to assign, THE Management_UI SHALL provide a "New player" action that collects a name of 1 to 100 characters, creates a master Player via `POST /players`, and then assigns the created Player to the selected Team with the entered jersey number, so that an Administrator can register a new person without leaving the Roster view. (This action is available only to a User authorized to create master Players, i.e. an Administrator.)
6. IF an authorized User assigns a Player with a jersey number outside 0 to 99 or a non-integer jersey number, or with a jersey number already used on the Team's Roster, THEN THE Management_UI SHALL surface the validation or conflict error returned by the System inline, and THE System SHALL create no Roster_Assignment.
7. IF an authorized User assigns a Player who already holds a Roster_Assignment to a Team in the same Season, THEN THE Management_UI SHALL surface the conflict error returned by the System indicating the Player is already assigned to a Team in that Season, and THE System SHALL create no Roster_Assignment.
8. WHEN an authorized User changes an existing Roster_Assignment's jersey number to a value in 0 to 99 that does not duplicate another assignment's jersey number on the same Team, THE System SHALL save the jersey number via `PATCH /teams/:teamId/assignments/:playerId` and THE Management_UI SHALL display the updated entry and show a success Notification.
9. WHEN an authorized User confirms removal of a Player from the Team through an accessible confirmation dialog, THE System SHALL remove that Roster_Assignment via `DELETE /teams/:teamId/assignments/:playerId`, SHALL retain the master Player, and THE Management_UI SHALL remove the entry from the displayed Roster and show a success Notification.
10. WHERE the selected Team has an empty Roster, THE Management_UI SHALL display an accessible empty-state message inviting the User to assign the first Player.

### Requirement 7: Public Browsing Views Use a Season Selector

**User Story:** As a Viewer, I want to pick a Season by name to browse its schedule, results, and standings, so that I do not have to obtain or paste a Season identifier.

#### Acceptance Criteria

1. WHEN a Viewer opens a public browsing view that requires a Season, THE Public_UI SHALL present the Season by name through a Selector rather than a free-text Identifier input.
2. WHEN a Viewer selects a Season in the public browsing view, THE Public_UI SHALL resolve the selection to the Season's Identifier internally and request the corresponding schedule, results, or standings.
3. WHERE the public Season Selector has no Seasons to present, THE Public_UI SHALL display an accessible empty-state message and SHALL NOT present a free-text Identifier fallback.
4. THE System SHALL provide an unauthenticated public List_Endpoint that returns Seasons available for public browsing, each entry including its Identifier, name, and closed flag, so that the Public_UI can populate the public Season Selector without requiring the Viewer to sign in.
5. WHEN a Viewer requests the public Seasons list, THE System SHALL return the collection of Seasons available for public browsing without requiring authentication, and WHERE no such Seasons exist SHALL return an empty collection rather than an error.
6. THE unauthenticated public Seasons List_Endpoint SHALL expose only Season fields required for browsing selection (Identifier, name, and closed flag) and SHALL NOT expose data restricted to authenticated management flows.

### Requirement 8: Tournament Management UI

**User Story:** As an Administrator, I want to create and list Tournaments within a Season from the Management_UI, so that I can organize structured competitions using named selectors instead of raw endpoints.

#### Acceptance Criteria

1. WHEN an Administrator opens the Tournament management view and selects a Season through a Season_Selector, THE Management_UI SHALL load the Tournaments of that Season from the List_Endpoint and display each Tournament's format and, where applicable, its round-robin kind.
2. WHEN an Administrator submits a new Tournament with a selected Season and a format of single-elimination, double-elimination, or round-robin, THE System SHALL create the Tournament and THE Management_UI SHALL add it to the displayed list and show a success Notification.
3. WHERE an Administrator selects the round-robin format when creating a Tournament, THE Management_UI SHALL require selection of a round-robin kind of single or double before submission.
4. IF an Administrator submits a Tournament with a format other than single-elimination, double-elimination, or round-robin, THEN THE Management_UI SHALL surface the validation error returned by the System, and THE System SHALL create no Tournament.
5. WHERE the selected Season has no Tournaments, THE Management_UI SHALL display an accessible empty-state message inviting the Administrator to create the first Tournament.
6. IF a Tournament create request fails, THEN THE Management_UI SHALL display an accessible error Notification conveying the failure reason from the error envelope, and SHALL leave the displayed Tournament list unchanged.

### Requirement 9: Playoff Round, Series, and Playoff Game Management UI

**User Story:** As an Administrator, I want to create Playoff_Rounds, best-of-N Series, and manual Playoff_Games within a Season from the Management_UI, so that I can set up playoffs without hand-editing identifiers.

#### Acceptance Criteria

1. WHEN an Administrator opens the playoff management view and selects a Season through a Season_Selector, THE Management_UI SHALL present controls to create Playoff_Rounds, Series, and Playoff_Games for that Season.
2. WHEN an Administrator submits a new Playoff_Round with a selected Season and a type of Quarterfinals, Semifinals, or Finals, THE System SHALL create the Playoff_Round and THE Management_UI SHALL display it and show a success Notification.
3. IF an Administrator submits a Playoff_Round with a type other than Quarterfinals, Semifinals, or Finals, THEN THE Management_UI SHALL surface the validation error returned by the System, and THE System SHALL create no Playoff_Round.
4. WHEN an Administrator submits a new Series with a Playoff_Round chosen from a Selector, two distinct Teams chosen from Team_Selectors, and a best-of-N value of 1, 3, 5, or 7, THE System SHALL create the Series and THE Management_UI SHALL display it and show a success Notification.
5. IF an Administrator submits a Series with a best-of-N value other than 1, 3, 5, or 7, THEN THE Management_UI SHALL surface the validation error returned by the System, and THE System SHALL create no Series.
6. WHEN an Administrator submits a new Playoff_Game with a Playoff_Round chosen from a Selector, two distinct Teams chosen from Team_Selectors, a date, and an optional Series, THE System SHALL create the Playoff_Game associated with that Playoff_Round and THE Management_UI SHALL show a success Notification.
7. IF an Administrator submits a Playoff_Game, Series, or Playoff_Round selection in which the two Teams are identical, THEN THE Management_UI SHALL surface the validation error indicating the two Teams must be distinct, and THE System SHALL create no record.
8. IF an Administrator attempts to create a Playoff_Game in a Season that is marked as closed, THEN THE Management_UI SHALL surface the error returned by the System indicating the Season is closed, and THE System SHALL create no Playoff_Game.
9. THE Management_UI SHALL present Playoff_Round, Series, and Team choices for playoff creation exclusively through named Selectors, and SHALL NOT require the Administrator to type an Identifier.
10. IF a playoff create request fails, THEN THE Management_UI SHALL display an accessible error Notification conveying the failure reason from the error envelope, and SHALL leave the displayed playoff data unchanged.

### Requirement 10: Adoption of the Mantine Component Library

**User Story:** As a User of the Management_UI, I want a consistent, modern interface built on a shared component library, so that forms, tables, dropdowns, and feedback behave predictably and accessibly.

#### Acceptance Criteria

1. THE System SHALL adopt the Component_Library (Mantine) for the Management_UI, providing a single theme and layout applied across the management views.
2. THE Management_UI SHALL render each Selector using the Component_Library's accessible Select component, presenting entities by name and supporting keyboard navigation.
3. THE Management_UI SHALL render entity lists (Seasons, Teams, Players) using the Component_Library's Table component with column headers.
4. THE Management_UI SHALL render create and edit forms using the Component_Library's form and input components with inline field-level validation messages.
5. THE Management_UI SHALL convey success and failure of create, update, delete, and close operations using the Component_Library's Notification component.
6. THE Management_UI SHALL replace all uses of `window.prompt`, `window.confirm`, and `window.alert` in the management views with Component_Library modals, forms, and Notifications.

### Requirement 11: Accessibility, Authorization, and Quality Gates

**User Story:** As a maintainer, I want the reworked UI to remain accessible, authorization-correct, and green across the toolchain, so that the change is safe to ship.

#### Acceptance Criteria

1. THE Management_UI SHALL associate every form input and Selector with a programmatic label and SHALL support operation via keyboard alone.
2. WHEN an operation succeeds or fails, THE Management_UI SHALL announce the outcome through an accessible Notification or status region so that assistive technologies convey the result.
3. THE Management_UI SHALL rely on the backend's role-based, team-scoped authorization as the source of truth, and SHALL present controls the current User is not authorized to use as unavailable rather than allowing a request that the System will reject.
4. WHEN the frontend and backend are built and checked, THE System SHALL pass typecheck, lint, build, and the existing automated test suites without new failures.
5. THE Management_UI SHALL NOT require a User to enter a raw Identifier in any normal management or browsing flow.
