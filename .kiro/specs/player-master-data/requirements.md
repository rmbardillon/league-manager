# Requirements Document

## Introduction

This feature changes how a person is modeled in the Basketball League Management System. Today a Player is a team-scoped record: the `players` table carries a `team_id` foreign key and a `jersey_number`, so a Player belongs to exactly one Team, and the same real person appearing on two Teams (across Seasons) is two unrelated records. This spec introduces **player master data** — the split of that single concept into two:

- A **Player (master)** is a person who exists once as a global record identified by name. A master Player carries no Team and no jersey number.
- A **Roster_Assignment** links a master Player to a Team (which belongs to exactly one Season) and carries the jersey number for that Team's Season. Jersey number lives here, not on the master Player.

Because a Team belongs to exactly one Season, an assignment is inherently per-Season. The same master Player may hold assignments to different Teams in different Seasons, but at most one assignment within any single Season. Removing a Player from a Team removes only that assignment; the master Player and the Player's other assignments remain.

This spec also covers the one-time, lossless migration of existing team-scoped `players` rows into master Players plus assignments, and it reconciles the dependent features (statistics, awards, batch upload) with the new model. Statistics and awards continue to reference the (master) Player identity; the migration preserves that identity so existing statistic and award references stay valid.

This spec is backend/domain-focused: data model, migration, domain/service logic, repository contracts, API behavior, and authorization. The assignment user interface is delivered by a separate spec (`management-ui`) and is out of scope here.

Where a requirement mirrors behavior already specified for the current model, it references the base spec as "base Requirement N" (`.kiro/specs/basketball-league-management`), but the acceptance criteria in this document are self-contained.

## Glossary

- **Player** (also **Player (master)** or **Master_Player**): a person, identified by an id and a name of 1–100 characters. Player names are NOT globally unique. A master Player has no Team and no jersey number.
- **Roster_Assignment** (also **Team_Membership**): a record linking one master Player to one Team, carrying a Jersey_Number. An assignment represents the Player's membership on that Team's Roster for that Team's Season.
- **Team**: a competitor within exactly one Season (unchanged from the base model), identified by an id, with a name unique (case-insensitive) within the Season.
- **Season**: a time-bounded competition within a League (unchanged from the base model). A Team belongs to exactly one Season, so a Team implies its Season.
- **Roster**: the set of master Players currently assigned to a given Team (i.e. the Team's Roster_Assignments).
- **Jersey_Number**: an integer in the range 0–99, a property of a Roster_Assignment, unique within a Team's Roster.
- **Player_History**: the set of Roster_Assignments for a given master Player, describing which Teams (and thus Seasons) that Player has been assigned to.
- **Administrator / Team_Manager / Viewer**: user roles (unchanged from the base model). A Team_Manager manages a set of Teams (`managedTeamIds`).
- **Migration**: the one-time transformation converting existing team-scoped `players` rows into master Players plus Roster_Assignments.
- **System**: the Basketball League Management System backend (domain, service, repository, and API layers).

## Requirements

### Requirement 1: Master Player Entity and CRUD

**User Story:** As an Administrator, I want to create and maintain people as global master Player records independent of any Team, so that one person can play for different Teams across different Seasons without being duplicated.

#### Acceptance Criteria

1. WHEN an Administrator creates a Player with a name of 1 to 100 characters, THE System SHALL create a master Player with a unique identifier and no Team and no jersey number, and SHALL return the created Player.
2. IF an Administrator creates or updates a Player with a name shorter than 1 character or longer than 100 characters, THEN THE System SHALL reject the request, create or change no Player, and return a ValidationError indicating the name field is invalid.
3. WHEN an Administrator creates a Player with a name identical to an existing Player's name, THE System SHALL create a distinct master Player and SHALL NOT treat the duplicate name as an error, because Player names are not globally unique.
4. WHEN an Administrator requests a Player by identifier that exists, THE System SHALL return that Player's identifier and name.
5. IF an Administrator requests, updates, or deletes a Player by an identifier that does not exist, THEN THE System SHALL reject the request and return a NotFoundError indicating the Player was not found.
6. WHEN an Administrator updates an existing Player's name to a value of 1 to 100 characters, THE System SHALL save the updated name and SHALL leave that Player's Roster_Assignments unchanged.
7. WHEN an Administrator requests a list of Players, THE System SHALL return the master Players, each showing its identifier and name.
8. IF an Administrator requests to delete a Player that has one or more Roster_Assignments, THEN THE System SHALL reject the request, delete no Player and no assignment, and return a ConflictError indicating the Player is still assigned to one or more Teams. (Chosen rule: cannot delete a master Player while assigned; unassign from all Teams first. This is the safer, non-cascading behavior and is noted as a design concern below.)
9. WHEN an Administrator deletes a Player that has no Roster_Assignments, THE System SHALL remove the master Player.

### Requirement 2: Roster Assignment (Assign and Unassign)

**User Story:** As a Team_Manager, I want to assign an existing master Player to my Team with a jersey number and to unassign the Player later, so that my Team's Roster for its Season stays current without duplicating the person.

#### Acceptance Criteria

1. WHEN an authorized user assigns an existing master Player to a Team with a jersey number in the range 0 to 99, THE System SHALL create a Roster_Assignment linking that Player to that Team with that jersey number, and SHALL return the created assignment. (Analogue of base Requirement 4.1.)
2. WHERE the acting user is a Team_Manager, WHEN that Team_Manager assigns or unassigns a Player on a Team included in that Team_Manager's managed Teams, THE System SHALL perform the operation; an Administrator SHALL be authorized for any Team.
3. IF a user attempts to assign or unassign a Player on a Team that the user is not authorized to manage, THEN THE System SHALL reject the request, leave all Roster_Assignments unchanged, and return an AuthorizationError, without disclosing whether the target Player or assignment exists. (Analogue of base Requirement 4.4.)
4. IF a user assigns a Player using a jersey number outside the range 0 to 99 or a non-integer jersey number, THEN THE System SHALL reject the request, create no assignment, and return a ValidationError indicating the jersey number field is invalid. (Analogue of base Requirement 4.3.)
5. WHEN an authorized user unassigns an existing Roster_Assignment, THE System SHALL remove that assignment, SHALL retain the master Player, and SHALL retain that Player's Roster_Assignments to other Teams. (Analogue of base Requirement 4.5.)
6. IF a user attempts to unassign a Player from a Team where that Player currently holds no Roster_Assignment, THEN THE System SHALL reject the request, leave all assignments unchanged, and return a NotFoundError indicating no assignment was found for that Player on that Team. (Analogue of base Requirement 4.6.)
7. WHEN an authorized user changes the jersey number of an existing Roster_Assignment to a value in the range 0 to 99 that does not duplicate another assignment's jersey number on the same Team's Roster, THE System SHALL save the updated jersey number. (Analogue of base Requirement 4.7.)

### Requirement 3: Assignment Constraints and Error Taxonomy

**User Story:** As an Administrator, I want assignment rules enforced consistently, so that rosters remain valid — one Team per Player per Season, unique jerseys within a Team, and clear typed errors.

#### Acceptance Criteria

1. IF a user assigns a Player to a Team with a jersey number already used by another Roster_Assignment on the same Team's Roster, THEN THE System SHALL reject the request, create no assignment, and return a ConflictError indicating a duplicate jersey number. (Analogue of base Requirement 4.2.)
2. IF a user assigns a Player to a Team when that Player already holds a Roster_Assignment to another Team in the same Season, THEN THE System SHALL reject the request, create no assignment, and return a ConflictError indicating the Player is already assigned to a Team in that Season.
3. WHEN a master Player holds a Roster_Assignment in one Season and is assigned to a Team in a different Season that passes all other checks, THE System SHALL create the assignment, because at most one assignment per Player per Season is permitted while assignments across different Seasons are permitted.
4. IF a user assigns a Player using a Player identifier that does not exist, THEN THE System SHALL reject the request, create no assignment, and return a NotFoundError indicating the Player was not found.
5. IF a user assigns a Player using a Team identifier that does not exist, THEN THE System SHALL reject the request, create no assignment, and return a NotFoundError indicating the Team was not found.
6. THE System SHALL express every rejection in this spec using the existing error taxonomy — ValidationError (invalid field), AuthorizationError (not permitted), NotFoundError (unknown Player, Team, or assignment), and ConflictError (duplicate jersey number or same-Season second assignment) — and SHALL perform no write when a request is rejected.

### Requirement 4: Roster and Player History Reads

**User Story:** As a Viewer, I want to see which Players are on a Team's Roster and which Teams a Player has been assigned to, so that I can follow players and rosters across Seasons.

#### Acceptance Criteria

1. WHEN a user requests a Team's Roster, THE System SHALL return each assigned master Player's identifier, name, and jersey number for that Team.
2. WHERE a Team has no Roster_Assignments, WHEN a user requests that Team's Roster, THE System SHALL return an empty Roster and SHALL NOT return an error.
3. WHERE Player_History is provided, WHEN a user requests the history of a master Player, THE System SHALL return the Roster_Assignments for that Player, each identifying the Team and its Season and the jersey number. (Player_History read is in scope for this spec; if effort requires, it may be deferred to a follow-up — see recommended deferrals.)

### Requirement 5: Statistics Continuity Over the New Model

**User Story:** As an Administrator, I want statistics to keep referencing the master Player and to respect assignment-based eligibility, so that per-Player and per-Team statistics remain correct after the model change.

#### Acceptance Criteria

1. THE System SHALL associate each Statistic with a master Player identifier, and SHALL keep existing Statistic references valid after the Migration because each migrated master Player retains the identifier previously used by the corresponding team-scoped Player. (See Requirement 7.)
2. WHEN an Administrator records a Statistic for a Player in a completed Game, THE System SHALL treat the Player as eligible if and only if that Player holds a Roster_Assignment to one of the two Teams participating in that Game for that Game's Season. (Analogue of base Requirement 8.5.)
3. IF an Administrator records a Statistic for a Player who holds no Roster_Assignment to either participating Team for the Game's Season, THEN THE System SHALL reject the request, retain any previously recorded Statistic, and return a ValidationError indicating the Player is not eligible for that Game.
4. WHEN the System aggregates per-Player and per-Team season statistics, THE System SHALL attribute a Player's recorded values to the Team the Player was assigned to for that Season via the Player's Roster_Assignment, preserving the base per-Player and per-Team season totals behavior (base Requirements 8.6–8.8).

### Requirement 6: Awards Continuity Over the New Model

**User Story:** As an Administrator, I want awards to keep referencing the master Player, so that award selection and display remain correct after the model change.

#### Acceptance Criteria

1. THE System SHALL associate each Award recipient with a master Player identifier, and SHALL keep existing Award recipient references valid after the Migration because each migrated master Player retains the previously used Player identifier.
2. WHEN the System selects Award recipients for a Season or Tournament scope, THE System SHALL consider Players by their Roster_Assignments within that scope's Season.

### Requirement 7: One-Time Lossless Migration of Existing Players

**User Story:** As an Administrator, I want the existing seeded and stored player data converted into the new model without any loss, so that current rosters, statistics, and awards remain intact after the change.

#### Acceptance Criteria

1. WHEN the Migration runs, THE System SHALL convert each existing team-scoped `players` row into one master Player preserving that row's name and one Roster_Assignment to that row's Team preserving that row's jersey number.
2. THE System SHALL preserve, for each migrated Player, the identifier previously used by the team-scoped `players` row as the master Player identifier, so that every Statistic and Award recipient reference that pointed to that identifier remains valid without modification.
3. THE Migration SHALL result in no loss of Players, Roster_Assignments (name, Team, jersey number), Statistics, or Award recipient references.
4. WHEN the Migration has completed successfully, THE System SHALL enforce jersey-number uniqueness within each Team's Roster and at most one Roster_Assignment per Player per Season for all migrated data.
5. IF the Migration is invoked after it has already completed successfully, THEN THE System SHALL make no further data changes, so that the Migration is safe to attempt without duplicating master Players or assignments.

### Requirement 8: Batch Upload Reconciled With the New Model

**User Story:** As an Administrator, I want batch upload of Teams and Players to populate the new model, so that I can still bulk-load a Season's rosters after the change.

#### Acceptance Criteria

1. WHEN an Administrator submits a Batch_Upload in which every row is valid, THE System SHALL create the referenced Teams as needed, create a master Player for each Player row, create a Roster_Assignment linking each created master Player to the row's Team with the row's jersey number, and return a confirmation reporting the number of records imported. (Analogue of base Requirements 11.1–11.2.)
2. THE System SHALL preserve the base all-or-nothing batch semantics: IF one or more rows are invalid (missing required field, duplicate jersey number within the same Team, name length outside 1–100 characters, or otherwise malformed data), THEN THE System SHALL reject the entire upload, import no records, and return a report listing each invalid row and its reason. (Analogue of base Requirements 11.3–11.4.)
3. WHERE a Batch_Upload row is imported, THE System SHALL create a new master Player for that row rather than reusing an existing master Player, unless a matching identity is explicitly supplied in the row. (Chosen default; the ambiguity of automatic identity resolution is recorded as a design concern rather than specified here — see recommended deferrals.)

### Requirement 9: Non-Functional and Architectural Constraints

**User Story:** As a maintainer, I want the change to fit the existing architecture and quality bar, so that the system stays consistent, secure, and buildable.

#### Acceptance Criteria

1. THE System SHALL preserve the layered architecture (pure domain logic, application services, repositories, API routes) and the existing structured error taxonomy for all behavior in this spec.
2. THE System SHALL enforce session-based, role-based authorization for assignment operations, applying team-scoped authorization (Administrator or the managing Team_Manager) consistently with the base roster rules.
3. WHEN the change is complete, THE System SHALL pass the project's typecheck, lint, build, and automated test steps.
4. THE System SHALL introduce no loss of existing data as a result of this change.

## Out of Scope

The following are explicitly out of scope for this spec:

- **Management UI** — dropdowns, assignment pages, and roster screens are delivered by the `management-ui` spec.
- **Player profile fields beyond name** — birthdate, height, position, photo, and similar attributes are not modeled here.
- **Global player-name uniqueness** — names remain non-unique; no dedup or "did you mean" matching.
- **Cross-league player identity resolution** — no automatic linking of the same real person across Leagues or from external identity sources.
- **Mid-season transfer workflow** — moving a Player between Teams within one Season is achieved only by unassign followed by assign; a dedicated transfer workflow is not specified.

## Recommended Deferrals and Design Concerns

- **Player deletion policy** (Requirement 1.8–1.9): this spec adopts the safer "cannot delete while assigned" rule. A cascading delete could be revisited later if a genuine need arises.
- **Player_History read** (Requirement 4.3): specified as in scope; acceptable to defer to a follow-up if implementation effort is high.
- **Batch identity resolution** (Requirement 8.3): the default creates a new master Player per row. Whether and how batch rows should reuse existing master Players (identity matching) is a design-phase decision and is intentionally left open here to avoid over-specifying.
