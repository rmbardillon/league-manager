CREATE TYPE "public"."award_category" AS ENUM('MVP', 'Mythical_5', 'Best_in_3_Pointers', 'DPOY', 'Assists_Leader', 'Finals_MVP');--> statement-breakpoint
CREATE TYPE "public"."game_status" AS ENUM('scheduled', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."playoff_round_type" AS ENUM('Quarterfinals', 'Semifinals', 'Finals');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('Administrator', 'Team_Manager', 'Viewer');--> statement-breakpoint
CREATE TYPE "public"."round_robin_kind" AS ENUM('single', 'double');--> statement-breakpoint
CREATE TYPE "public"."schedule_state" AS ENUM('draft', 'official');--> statement-breakpoint
CREATE TYPE "public"."statistic_type" AS ENUM('Points', 'Assists', 'Rebounds', 'Steals', 'Blocks', 'Three_Pointers_Made');--> statement-breakpoint
CREATE TYPE "public"."tournament_format" AS ENUM('single-elimination', 'double-elimination', 'round-robin');--> statement-breakpoint
CREATE TABLE "award_players" (
	"award_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	CONSTRAINT "award_players_award_id_player_id_pk" PRIMARY KEY("award_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_id" uuid NOT NULL,
	"category" "award_category" NOT NULL,
	"published" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"home_team_id" uuid NOT NULL,
	"away_team_id" uuid NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"start_time" text,
	"duration_minutes" integer,
	"venue" text,
	"status" "game_status" DEFAULT 'scheduled' NOT NULL,
	"schedule_state" "schedule_state" DEFAULT 'official' NOT NULL,
	"playoff_round_id" uuid,
	"series_id" uuid,
	CONSTRAINT "games_distinct_teams_chk" CHECK ("games"."home_team_id" <> "games"."away_team_id"),
	CONSTRAINT "games_duration_range_chk" CHECK ("games"."duration_minutes" is null or "games"."duration_minutes" between 1 and 480)
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"jersey_number" smallint NOT NULL,
	CONSTRAINT "players_team_jersey_uq" UNIQUE("team_id","jersey_number"),
	CONSTRAINT "players_name_len_chk" CHECK (char_length("players"."name") between 1 and 100),
	CONSTRAINT "players_jersey_range_chk" CHECK ("players"."jersey_number" between 0 and 99)
);
--> statement-breakpoint
CREATE TABLE "playoff_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"type" "playoff_round_type" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"game_id" uuid PRIMARY KEY NOT NULL,
	"home_score" integer NOT NULL,
	"away_score" integer NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "scores_home_range_chk" CHECK ("scores"."home_score" between 0 and 999),
	CONSTRAINT "scores_away_range_chk" CHECK ("scores"."away_score" between 0 and 999)
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"final_standings_snapshot" jsonb,
	CONSTRAINT "seasons_league_name_uq" UNIQUE("league_id","name"),
	CONSTRAINT "seasons_name_len_chk" CHECK (char_length("seasons"."name") between 1 and 100),
	CONSTRAINT "seasons_date_order_chk" CHECK ("seasons"."end_date" > "seasons"."start_date")
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"playoff_round_id" uuid NOT NULL,
	"team_a_id" uuid NOT NULL,
	"team_b_id" uuid NOT NULL,
	"best_of" smallint NOT NULL,
	CONSTRAINT "series_best_of_chk" CHECK ("series"."best_of" in (1, 3, 5, 7)),
	CONSTRAINT "series_distinct_teams_chk" CHECK ("series"."team_a_id" <> "series"."team_b_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statistics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"type" "statistic_type" NOT NULL,
	"value" integer NOT NULL,
	CONSTRAINT "statistics_player_game_type_uq" UNIQUE("player_id","game_id","type"),
	CONSTRAINT "statistics_value_range_chk" CHECK ("statistics"."value" between 0 and 999)
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "teams_name_len_chk" CHECK (char_length("teams"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"format" "tournament_format" NOT NULL,
	"round_robin_kind" "round_robin_kind"
);
--> statement-breakpoint
CREATE TABLE "user_failed_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_managed_teams" (
	"user_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	CONSTRAINT "user_managed_teams_user_id_team_id_pk" PRIMARY KEY("user_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role",
	"locked_until" timestamp with time zone,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "award_players" ADD CONSTRAINT "award_players_award_id_awards_id_fk" FOREIGN KEY ("award_id") REFERENCES "public"."awards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_players" ADD CONSTRAINT "award_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_playoff_round_id_playoff_rounds_id_fk" FOREIGN KEY ("playoff_round_id") REFERENCES "public"."playoff_rounds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playoff_rounds" ADD CONSTRAINT "playoff_rounds_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_playoff_round_id_playoff_rounds_id_fk" FOREIGN KEY ("playoff_round_id") REFERENCES "public"."playoff_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_team_a_id_teams_id_fk" FOREIGN KEY ("team_a_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_team_b_id_teams_id_fk" FOREIGN KEY ("team_b_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statistics" ADD CONSTRAINT "statistics_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statistics" ADD CONSTRAINT "statistics_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_failed_attempts" ADD CONSTRAINT "user_failed_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_managed_teams" ADD CONSTRAINT "user_managed_teams_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_managed_teams" ADD CONSTRAINT "user_managed_teams_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "teams_season_name_ci_uq" ON "teams" USING btree ("season_id",lower("name"));--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_name_len_chk" CHECK (char_length("leagues"."name") between 1 and 100);