# Requirements Document

## Introduction

The Basketball League Management System is a web application for organizing and running basketball leagues. It enables administrators to manage teams, players, game schedules, scores, standings, and statistics across seasons and tournaments. The system supports multiple user roles (Administrator, Team Manager, and Viewer) with different levels of access. This document defines the functional and quality requirements for the feature.

## Glossary

- **System**: The Basketball League Management web application as a whole.
- **Administrator**: A user with full access to create, read, update, and delete leagues, seasons, teams, players, games, and user accounts.
- **Team_Manager**: A user assigned to one or more teams who can manage that team's roster and view that team's schedule and statistics.
- **Viewer**: An unauthenticated or authenticated user who can browse public information such as schedules, scores, standings, and statistics without modification rights.
- **User**: Any actor interacting with the System (Administrator, Team_Manager, or Viewer).
- **League**: A named competition grouping one or more Seasons.
- **Season**: A time-bounded period within a League containing Teams and Games.
- **Tournament**: A structured competition (single or double elimination, or round-robin) within a Season.
- **Team**: A named group of Players participating in a Season.
- **Player**: An individual registered to a Team, identified by name and jersey number.
- **Roster**: The set of Players assigned to a Team for a Season.
- **Game**: A scheduled match between two Teams, with a date, time, and venue.
- **Score**: The recorded points for each Team in a completed Game.
- **Standings**: A ranked list of Teams in a Season based on wins, losses, and other criteria.
- **Statistic**: A recorded non-negative integer measure for a Player in a Game, restricted to a fixed enumerated set of exactly six types: Points, Assists, Rebounds, Steals, Blocks, and Three_Pointers_Made.
- **Statistic_Type**: One of the six permitted Statistic categories: Points, Assists, Rebounds, Steals, Blocks, or Three_Pointers_Made.
- **Head_to_Head**: The record of Games played directly between a specific set of tied Teams, counted only among those tied Teams; a Team with more wins in those direct Games ranks higher.
- **Points_Ratio**: A tiebreaker value computed for a Team as total points scored (from Game Scores) divided by total points allowed (from Game Scores) across the Season, where Game Scores are the recorded final scores of completed Games per Requirement 6 and are distinct from the per-Player "Points" Statistic; a higher Points_Ratio ranks higher.
- **Batch_Upload**: An operation in which an Administrator submits a CSV or Excel (.xlsx) file to create multiple Teams or Players in a single all-or-nothing transaction.
- **Round_Robin**: A scheduling format in which each pair of Teams plays a fixed number of Games; single Round_Robin means each pair plays once, and double Round_Robin means each pair plays twice.
- **Draft_Schedule**: A provisionally generated set of Games that is editable by the Administrator and not visible to Viewers until submitted, at which point the Games become official scheduled Games.
- **Playable_Day**: A day of the week selected by the Administrator on which generated Games may be assigned.
- **Venue**: A physical location where a Game is played.
- **Award**: A recognition granted for a Season or Tournament. Award categories are: MVP (highest combined total of all six Statistic_Type values for a Player), Mythical 5 (the top five Players by that same combined total), Best in 3-Pointers (highest total Three_Pointers_Made), DPOY (Defensive Player of the Year, highest combined total of Steals and Blocks), Assists Leader (highest total Assists), and Finals MVP (the standout Player on the champion Team across the Finals). All stat-based Awards other than Finals MVP (MVP, Mythical 5, Best in 3-Pointers, DPOY, and Assists Leader) are auto-computed by the System from regular season Statistics only, excluding playoff Games. Finals MVP is auto-computed by the System from playoff Games as described in the Awards requirement. An Award is either unpublished (not visible to Viewers) or published (visible to Viewers).
- **Combined_Statistic_Total**: For a Player over a Season or Tournament, the sum of that Player's totals across all six Statistic_Type values (Points, Assists, Rebounds, Steals, Blocks, and Three_Pointers_Made).
- **Playoff_Round**: A stage of playoff competition identified by a round type such as Quarterfinals, Semifinals, or Finals. Each playoff Game is associated with exactly one Playoff_Round.
- **Series**: A set of playoff Games between the same two Teams within a Playoff_Round, decided by a best-of-N format (best-of-1, best-of-3, best-of-5, or best-of-7), where the Team that first wins a majority (more than half) of N Games wins the Series. A best-of-1 Series is a single decisive Game, and the Team that wins that one Game wins the Series; under the majority rule, for N=1 the winner needs 1 win.
- **Finals**: The Playoff_Round of type Finals; its Games determine the champion Team.
- **Total_Statistics_Points**: Abbreviated TSP. For a Player over a specified set of Games, the sum of that Player's Points, Assists, Rebounds, Steals, and Blocks across those Games. Note: TSP intentionally excludes Three_Pointers_Made.
- **Authentication_Service**: The System component responsible for verifying user identity.
- **Authorization_Service**: The System component responsible for enforcing role-based access.

## Requirements

### Requirement 1: User Authentication

**User Story:** As a User, I want to sign in with my credentials, so that I can access features appropriate to my role.

#### Acceptance Criteria

1. WHEN a User submits valid credentials, THE Authentication_Service SHALL establish an authenticated session scoped to the User's role and grant access within 2 seconds of submission.
2. WHILE an authenticated session is active, THE Authentication_Service SHALL maintain the session until sign-out or until 30 minutes of User inactivity elapse, after which THE Authentication_Service SHALL terminate the session and require re-authentication.
3. IF a User submits invalid credentials, THEN THE Authentication_Service SHALL reject the request within 2 seconds, retain no authenticated session, and return an error message indicating that the credentials are not valid without disclosing which field was incorrect.
4. IF a User submits a sign-in request with one or more required credential fields empty, THEN THE Authentication_Service SHALL reject the request, retain no authenticated session, and return an error message indicating which required field is missing.
5. WHEN a User with an active session requests to sign out, THE Authentication_Service SHALL terminate the session within 2 seconds and invalidate the session so that subsequent requests require re-authentication.
6. IF a User submits credentials unsuccessfully more than 5 times within a rolling 15-minute window, THEN THE Authentication_Service SHALL lock the account for 15 minutes, reject any sign-in attempt during the lock period, and return an error message indicating that the account is temporarily locked and the remaining lock duration.

### Requirement 2: Role-Based Access Control

**User Story:** As an Administrator, I want each User to have a defined role, so that access to features is controlled by permission level.

#### Acceptance Criteria

1. THE System SHALL assign exactly one primary role of Administrator, Team_Manager, or Viewer to each authenticated User.
2. IF a Team_Manager requests to modify a Team that is not assigned to that Team_Manager, THEN THE Authorization_Service SHALL deny the request, return an error response indicating the User is not authorized for that Team, and leave the Team's data unchanged.
3. IF a Viewer requests any create, update, or delete operation, THEN THE Authorization_Service SHALL deny the request, return an error response indicating the operation is not permitted for the Viewer role, and leave the target resource unchanged.
4. WHERE a User is an Administrator, THE Authorization_Service SHALL grant access to all create, read, update, and delete operations on Teams and Users.
5. IF an authenticated User has no primary role assigned, THEN THE Authorization_Service SHALL deny every requested operation and return an error response indicating no role is assigned.

### Requirement 3: Team Management

**User Story:** As an Administrator, I want to manage teams, so that leagues have accurate participant records.

#### Acceptance Criteria

1. WHEN an Administrator submits a Team with a name between 1 and 100 characters and a valid Season, THE System SHALL create the Team and associate it with the Season.
2. IF an Administrator submits a Team with a name that is empty or exceeds 100 characters, THEN THE System SHALL reject the request and return a validation error indicating the name length constraint, and SHALL NOT create the Team.
3. IF an Administrator submits a Team with a Season that does not exist, THEN THE System SHALL reject the request and return an error indicating the Season was not found, and SHALL NOT create the Team.
4. IF an Administrator submits a Team name that already matches an existing Team name within the same Season using case-insensitive comparison, THEN THE System SHALL reject the request and return a duplicate-name error, and SHALL NOT create the Team.
5. WHEN an Administrator updates an existing Team's details with a name between 1 and 100 characters that does not duplicate another Team name within the same Season, THE System SHALL save the updated details and return the updated Team record.
6. IF an Administrator updates a Team using a Team identifier that does not exist, THEN THE System SHALL reject the request and return an error indicating the Team was not found, and SHALL preserve all existing Team records unchanged.
7. WHEN an Administrator deletes an existing Team that has zero completed Games, THE System SHALL remove the Team from the Season and return a confirmation of removal.
8. IF an Administrator requests to delete a Team that has one or more completed Games, THEN THE System SHALL reject the request and return a constraint error indicating the Team has completed Games, and SHALL retain the Team and all associated records unchanged.

### Requirement 4: Player and Roster Management

**User Story:** As a Team_Manager, I want to manage players on my team's roster, so that team records stay current.

#### Acceptance Criteria

1. WHEN a Team_Manager adds a Player with a name of 1 to 100 characters and a jersey number in the range 0 to 99 to a Team assigned to that Team_Manager, THE System SHALL add the Player to the Roster.
2. IF a Team_Manager adds a Player with a jersey number already used by another Player on the same Team's Roster, THEN THE System SHALL reject the request, leave the Roster unchanged, and return an error indicating a duplicate jersey number.
3. IF a Team_Manager adds or updates a Player with a name shorter than 1 character or longer than 100 characters, or with a jersey number outside the range 0 to 99, THEN THE System SHALL reject the request, leave the Roster unchanged, and return an error indicating the invalid field.
4. IF a Team_Manager attempts to add, remove, or update a Player on a Team not assigned to that Team_Manager, THEN THE System SHALL reject the request, leave the Roster unchanged, and return an authorization error.
5. WHEN a Team_Manager removes an existing Player from an assigned Team's Roster, THE System SHALL remove the Player from the Roster.
6. IF a Team_Manager attempts to remove or update a Player that does not exist on the assigned Team's Roster, THEN THE System SHALL reject the request, leave the Roster unchanged, and return an error indicating the Player was not found.
7. WHEN a Team_Manager updates an existing Player's name or jersey number on an assigned Team with values that satisfy the validation bounds in criterion 3 and that do not duplicate another Player's jersey number on the same Team's Roster, THE System SHALL save the updated values to the Roster.

### Requirement 5: Game Scheduling

**User Story:** As an Administrator, I want to schedule games between teams, so that participants know when and where to play.

#### Acceptance Criteria

1. WHEN an Administrator submits a Game with two distinct Teams, a date, a start time, a duration between 1 and 480 minutes, and a Venue, THE System SHALL create the Game and return the created Game with a unique identifier.
2. IF an Administrator submits a Game that is missing any of the required fields (either Team, date, start time, duration, or Venue), THEN THE System SHALL reject the request and return a validation error indicating which required field is missing, and THE System SHALL NOT create the Game.
3. IF an Administrator submits a Game where both Teams are identical, THEN THE System SHALL reject the request and return a validation error indicating that the two Teams must be distinct, and THE System SHALL NOT create the Game.
4. IF an Administrator submits a Game with a date and start time earlier than the current date and time, THEN THE System SHALL reject the request and return a validation error indicating that the schedule must be in the future, and THE System SHALL NOT create the Game.
5. IF an Administrator schedules a Game at a Venue whose time interval (from start time through start time plus duration) overlaps the time interval of any existing non-cancelled Game at the same Venue, THEN THE System SHALL reject the request and return a conflict error identifying the conflicting Game, and THE System SHALL NOT create the Game.
6. WHEN an Administrator reschedules an existing non-cancelled Game to a new date and start time that pass the validation in criteria 4 and the conflict check in criterion 5, THE System SHALL save the updated schedule and return the updated Game.
7. IF an Administrator attempts to reschedule a Game that is marked as cancelled, THEN THE System SHALL reject the request and return a validation error indicating that a cancelled Game cannot be rescheduled, and THE System SHALL retain the existing schedule.
8. WHEN an Administrator cancels a scheduled Game, THE System SHALL mark the Game as cancelled, retain the Game record, and return the updated Game status.

### Requirement 6: Score Recording

**User Story:** As an Administrator, I want to record final scores for games, so that results and standings are updated.

#### Acceptance Criteria

1. WHEN an Administrator submits a Score with an integer between 0 and 999 inclusive for each Team of a Game not yet marked as completed, THE System SHALL record the Score, mark the Game as completed, and complete the operation within 3 seconds.
2. IF an Administrator submits a Score containing a negative value, a non-integer value, a value outside the range 0 to 999, or a missing value for either Team, THEN THE System SHALL reject the request, retain any previously recorded Score, and return a validation error indicating which value is invalid.
3. WHEN a Score is recorded for a Game, THE System SHALL update the Standings for the Season within 5 seconds.
4. WHEN an Administrator corrects the Score of an already-completed Game with integer values between 0 and 999 inclusive for each Team, THE System SHALL save the updated Score and recalculate the Standings for the Season within 5 seconds.
5. IF an Administrator submits an initial Score for a Game already marked as completed, THEN THE System SHALL reject the request and return an error indicating the Game is already completed, directing the Administrator to use score correction instead.

### Requirement 7: Standings Calculation

**User Story:** As a Viewer, I want to see team standings, so that I can track team performance in a season.

#### Acceptance Criteria

1. THE System SHALL calculate Standings for a Season by ranking Teams in descending order of wins as the primary criterion.
2. WHERE two or more Teams have an equal number of wins, THE System SHALL rank those tied Teams in ascending order of losses.
3. WHERE two or more Teams have an equal number of wins and an equal number of losses, THE System SHALL rank those tied Teams by Head_to_Head record among the tied Teams, ranking a Team with more wins in Games played directly against the other tied Teams higher.
4. WHERE the Head_to_Head record does not resolve the tie among the tied Teams, THE System SHALL rank those Teams in descending order of Points_Ratio, where Points_Ratio is computed from Game Scores (the recorded final scores of completed Games per Requirement 6) and not from the per-Player "Points" Statistic.
5. WHERE a tied Team has zero total points allowed, THE System SHALL treat that Team's Points_Ratio as higher than the Points_Ratio of any tied Team with a non-zero total points allowed, ranking the zero-points-allowed Team higher.
6. WHERE two or more Teams remain tied after wins, losses, Head_to_Head, and Points_Ratio are applied, THE System SHALL rank those Teams in ascending alphabetical order of Team name as the final deterministic tiebreaker.
7. WHERE two or more Teams are tied on all ranking criteria including Team name, THE System SHALL assign those Teams the same rank value.
8. WHEN a Viewer requests the Standings for a Season, THE System SHALL display each Team's wins, losses, and rank.
9. IF a Viewer requests the Standings for a Season that has no Teams, THEN THE System SHALL display an empty Standings list with an indication that no Teams are present, and SHALL NOT return an error.

### Requirement 8: Statistics Tracking

**User Story:** As a Viewer, I want to view player and team statistics, so that I can evaluate performance.

#### Acceptance Criteria

1. THE System SHALL restrict Statistic_Type to exactly six values: Points, Assists, Rebounds, Steals, Blocks, and Three_Pointers_Made.
2. WHEN an Administrator records a value for one of the six Statistic_Type values for a Player in a completed Game, THE System SHALL store the value as a non-negative integer associated with that Player, Game, and Statistic_Type.
3. IF an Administrator records a Statistic value that is negative, non-integer, or outside the range 0 to 999, THEN THE System SHALL reject the request, retain any previously recorded Statistic, and return an error indicating the value is invalid.
4. IF an Administrator records a Statistic using a Statistic_Type that is not one of the six permitted values, THEN THE System SHALL reject the request, retain any previously recorded Statistic, and return an error indicating the Statistic_Type is not supported.
5. IF an Administrator records a Statistic for a Player who is not on a Team participating in the specified Game, THEN THE System SHALL reject the request and return an error indicating the Player is not eligible for that Game.
6. WHEN a Viewer requests a Player's season statistics, THE System SHALL display, for each of the six Statistic_Type values, the sum of that Player's recorded values of that Statistic_Type across the specified Season within 3 seconds.
7. WHERE a Player has no recorded Statistics of a given Statistic_Type for the specified Season, THE System SHALL display a value of zero for that Player's season total of that Statistic_Type.
8. WHEN a Viewer requests a Team's season statistics, THE System SHALL display, for each of the six Statistic_Type values, the sum of that Statistic_Type across all Players on that Team for the specified Season within 3 seconds.

### Requirement 9: Season and Tournament Management

**User Story:** As an Administrator, I want to manage seasons and tournaments, so that competitions are organized over time.

#### Acceptance Criteria

1. WHEN an Administrator submits a Season with a name between 1 and 100 characters, a start date, and an end date within a League, THE System SHALL create the Season and return a confirmation identifying the created Season.
2. IF an Administrator submits a Season whose end date is the same as or precedes its start date, THEN THE System SHALL reject the request, return a validation error indicating the end date must be after the start date, and create no Season.
3. IF an Administrator submits a Season with a name that is empty, exceeds 100 characters, or duplicates the name of an existing Season within the same League, THEN THE System SHALL reject the request, return a validation error indicating the specific naming violation, and create no Season.
4. WHEN an Administrator creates a Tournament with a format of single-elimination, double-elimination, or round-robin within a Season, THE System SHALL create the Tournament and return a confirmation identifying the created Tournament.
5. IF an Administrator submits a Tournament with a format other than single-elimination, double-elimination, or round-robin, THEN THE System SHALL reject the request, return a validation error indicating the format is not supported, and create no Tournament.
6. WHERE a Season or Tournament uses a Round_Robin format, THE System SHALL support single Round_Robin and double Round_Robin as the user-selectable scheduling formats.
7. WHERE a competition uses a playoff format, THE System SHALL require the Administrator to create playoff Games manually, SHALL NOT automatically generate playoff brackets, and SHALL associate each manually created playoff Game with a Playoff_Round and an optional Series best-of-N format.
8. THE System SHALL classify each Game as belonging either to the regular season or to exactly one Playoff_Round, and THE System SHALL associate regular-season Games with no Playoff_Round.
9. WHEN an Administrator creates a playoff Game, THE System SHALL require an associated Playoff_Round of Quarterfinals, Semifinals, or Finals.
10. WHEN an Administrator creates a Series for a Playoff_Round, THE System SHALL require a best-of-N format of best-of-1, best-of-3, best-of-5, or best-of-7.
11. IF an Administrator creates a Series with a best-of-N format other than best-of-1, best-of-3, best-of-5, or best-of-7, THEN THE System SHALL reject the request, return a validation error indicating the best-of-N format is not supported, and create no Series.
12. THE System SHALL determine the winner of a Series as the Team that wins more than half of the N Games in that Series.
13. WHEN an Administrator marks a Season as closed, THE System SHALL prevent creation of new Games within that Season and return an error indicating the Season is closed for any subsequent Game creation attempt within that Season.

### Requirement 10: Public Browsing

**User Story:** As a Viewer, I want to browse schedules, scores, and standings without signing in, so that I can follow the league easily.

#### Acceptance Criteria

1. WHEN a Viewer requests the schedule of a Season, THE System SHALL display all scheduled Games of that Season ordered by date and time ascending, each showing its date, start time, Venue name, and both participating Teams within 3 seconds.
2. IF a Viewer requests the schedule of a Season that has no scheduled Games, THEN THE System SHALL display a message indicating that no Games are scheduled and SHALL NOT display an error.
3. WHEN a Viewer requests the results of a Season, THE System SHALL display all completed Games of that Season, each showing the final Score of both participating Teams and the date the Game was completed, within 3 seconds.
4. WHERE a Season is not marked as closed, WHEN a Viewer requests the Standings of that Season, THE System SHALL display the current Standings listing each Team ranked in descending order by wins, showing each Team's wins, losses, and rank, within 3 seconds.
5. WHERE a Season is marked as closed, WHEN a Viewer requests the Standings of that Season, THE System SHALL display the final Standings recorded when the Season was closed.
6. WHEN a Viewer requests a schedule, results, or Standings, THE System SHALL provide the requested data without requiring the Viewer to sign in.

### Requirement 11: Batch Upload of Teams and Players

**User Story:** As an Administrator, I want to batch upload Teams and Players from a file, so that I can populate a Season quickly without entering each record manually.

#### Acceptance Criteria

1. WHERE an Administrator submits a Batch_Upload, THE System SHALL accept files in CSV format and Excel (.xlsx) format.
2. WHEN an Administrator submits a Batch_Upload in which every row is valid, THE System SHALL import all Teams and Players from the file and return a confirmation reporting the number of records imported.
3. IF an Administrator submits a Batch_Upload in which one or more rows are invalid, THEN THE System SHALL reject the entire upload, import no records, and return a report listing each invalid row and the reason that row failed.
4. THE System SHALL treat as invalid any row that has a missing required field, a duplicate jersey number within the same Team, a name length outside the range 1 to 100 characters, or otherwise malformed data.
5. IF an Administrator submits a Batch_Upload in a file format other than CSV or Excel (.xlsx), THEN THE System SHALL reject the entire upload, import no records, and return an error indicating the file format is not supported.
6. IF an Administrator submits a Batch_Upload file that contains no data rows, THEN THE System SHALL reject the upload, import no records, and return an error indicating the file is empty.

### Requirement 12: Automatic Schedule Generation

**User Story:** As an Administrator, I want to automatically generate a Round_Robin schedule for a Season or Tournament, so that I can produce Games across playable days without scheduling each Game manually.

#### Acceptance Criteria

1. IF a User who is not an Administrator requests automatic schedule generation, THEN THE Authorization_Service SHALL deny the request and return an error indicating the operation requires Administrator privileges.
2. WHEN an Administrator requests automatic schedule generation, THE System SHALL accept a date range with a start date and an end date, a selection of Playable_Day values, a Round_Robin format selection of single or double, and the number of Games per Playable_Day.
3. IF an Administrator submits automatic schedule generation with an end date that precedes the start date, THEN THE System SHALL reject the request and return a validation error indicating the end date must not precede the start date, and SHALL generate no Games.
4. IF an Administrator submits automatic schedule generation with no Playable_Day selected, THEN THE System SHALL reject the request and return a validation error indicating at least one Playable_Day must be selected, and SHALL generate no Games.
5. IF an Administrator submits automatic schedule generation with a number of Games per Playable_Day less than 1, THEN THE System SHALL reject the request and return a validation error indicating the number of Games per Playable_Day must be at least 1, and SHALL generate no Games.
6. IF an Administrator submits automatic schedule generation for a Season with fewer than two Teams, THEN THE System SHALL reject the request and return a validation error indicating at least two Teams are required, and SHALL generate no Games.
7. WHEN an Administrator requests automatic schedule generation with a single Round_Robin format, THE System SHALL generate the set of required matchups such that each pair of Teams plays exactly one Game.
8. WHEN an Administrator requests automatic schedule generation with a double Round_Robin format, THE System SHALL generate the set of required matchups such that each pair of Teams plays exactly two Games.
9. THE System SHALL assign each generated Game only to a date that falls within the date range and falls on a selected Playable_Day.
10. THE System SHALL create each generated Game with no start time and no Venue assigned.
11. WHILE a Draft_Schedule is in draft state, THE System SHALL allow the Administrator to assign a Venue and a start time to each generated Game.
12. THE System SHALL distribute the generated Games across the available Playable_Day dates so that the total number of Games assigned to each Team is balanced, such that the difference in total Games assigned between any two Teams is the minimum achievable given the required Round_Robin matchups.
13. THE System SHALL distribute the dates on which each Team plays so that the rest between each Team's consecutive Games is as even as practical across the available Playable_Day dates, without prohibiting any specific spacing between a Team's Games.
14. THE System SHALL place at most the specified number of Games on each Playable_Day.
15. WHEN the System generates a schedule, THE System SHALL create the generated Games as a Draft_Schedule that is not visible to Viewers.
16. WHILE a Draft_Schedule is in draft state, THE System SHALL allow the Administrator to reschedule generated Games and to re-generate the Draft_Schedule.
17. WHEN an Administrator submits a Draft_Schedule, THE System SHALL convert the draft Games into official scheduled Games that are visible to Viewers.
18. IF the date range, selected Playable_Day values, and Games per Playable_Day cannot accommodate all required matchups, THEN THE System SHALL reject the generation and return an error indicating insufficient scheduling capacity, reporting the matchups that could not be placed.

### Requirement 13: Awards

**User Story:** As an Administrator, I want the System to compute statistical Awards for a Season or Tournament and let me publish them, so that Viewers can see recognized Players once results are finalized.

#### Acceptance Criteria

1. WHEN an Administrator requests Award computation for a Season or Tournament in which at least one Player has recorded regular season Statistics, THE System SHALL compute each regular-season stat-based Award (MVP, Mythical 5, Best in 3-Pointers, DPOY, and Assists Leader) from the Player Statistics recorded in regular season Games only, excluding playoff Games.
2. WHEN the System computes the MVP Award for a Season or Tournament, THE System SHALL select the Player with the highest Combined_Statistic_Total across the regular season Games of that Season or Tournament.
3. WHEN the System computes the Mythical 5 Award for a Season or Tournament, THE System SHALL select the five Players with the highest Combined_Statistic_Total across the regular season Games of that Season or Tournament, ordered in descending Combined_Statistic_Total.
4. WHEN the System computes the Best in 3-Pointers Award for a Season or Tournament, THE System SHALL select the Player with the highest total Three_Pointers_Made across the regular season Games of that Season or Tournament.
5. WHEN the System computes the DPOY Award for a Season or Tournament, THE System SHALL select the Player with the highest combined total of Steals and Blocks across the regular season Games of that Season or Tournament.
6. WHEN the System computes the Assists Leader Award for a Season or Tournament, THE System SHALL select the Player with the highest total Assists across the regular season Games of that Season or Tournament.
7. WHERE two or more Players are tied on the ranking metric of a regular-season stat-based Award, THE System SHALL break the tie by ranking the Player with the higher total Points across the regular season Games higher, and WHERE the total Points remain equal, THE System SHALL rank those Players in ascending alphabetical order of Player name.
8. WHERE the Mythical 5 Award has more candidate Players than remaining positions at a tied Combined_Statistic_Total, THE System SHALL apply the same tie-breaking order defined in criterion 7 to determine which Players occupy the remaining positions.
9. WHEN an Administrator requests Award computation for a Season or Tournament that has completed Finals Games, THE System SHALL compute the Finals MVP as the Player on the Series-winning champion Team with the highest Total_Statistics_Points across all Finals Games, restricting the Finals MVP candidate pool to Players on the champion Team.
10. WHERE two or more Players on the champion Team are tied on Finals Total_Statistics_Points, THE System SHALL break the tie by recomputing Total_Statistics_Points across all playoff Games of every Playoff_Round for those tied Players and ranking the higher full-playoffs Total_Statistics_Points higher.
11. WHERE the full-playoffs Total_Statistics_Points remains tied, THE System SHALL break the tie by ranking the Player with the higher total Points across all playoff Games higher, and WHERE the total Points remain equal, THE System SHALL rank those Players in ascending alphabetical order of Player name.
12. IF a Season or Tournament has no completed Finals Games, THEN THE System SHALL compute no Finals MVP and return an indication that the Finals MVP is not yet available.
13. WHEN an Administrator publishes the Awards for a Season or Tournament, THE System SHALL mark those Awards as published and make them visible to Viewers.
14. WHILE the Awards for a Season or Tournament are unpublished, THE System SHALL hide those Awards from Viewers.
15. WHEN a Viewer requests the Awards for a Season or Tournament, THE System SHALL display only the Awards that are published for that Season or Tournament.
16. IF no Player has any recorded regular season Statistics for a Season or Tournament, THEN THE System SHALL compute no regular-season stat-based Awards and return an indication that no regular-season Awards are available for that Season or Tournament.
