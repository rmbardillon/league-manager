-- Player master-data migration (hand-edited; see design.md "Migration Design").
--
-- Safe ordering: (1) create roster_assignments + its FKs, (2) idempotent
-- backfill one assignment per legacy players row from players.team_id /
-- players.jersey_number, (3) drop the old players constraints/columns.
--
-- The backfill reads p.team_id and p.jersey_number, so it MUST run before
-- those columns are dropped. statistics / award_players are untouched; no FK
-- into players.id is dropped or re-pointed, preserving existing references.

-- (1) Create the new roster_assignments table.
CREATE TABLE "roster_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"jersey_number" smallint NOT NULL,
	CONSTRAINT "roster_assignments_team_jersey_uq" UNIQUE("team_id","jersey_number"),
	CONSTRAINT "roster_assignments_jersey_range_chk" CHECK ("roster_assignments"."jersey_number" between 0 and 99)
);
--> statement-breakpoint
ALTER TABLE "roster_assignments" ADD CONSTRAINT "roster_assignments_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_assignments" ADD CONSTRAINT "roster_assignments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- (2) Idempotent backfill: one assignment per legacy players row. Runs while
-- players.team_id / players.jersey_number still exist, i.e. before the drops
-- below. The NOT EXISTS guard makes a replay a no-op (Req 7.5).
INSERT INTO "roster_assignments" ("id", "player_id", "team_id", "jersey_number")
SELECT gen_random_uuid(), p."id", p."team_id", p."jersey_number"
FROM "players" p
WHERE NOT EXISTS (
	SELECT 1 FROM "roster_assignments" ra WHERE ra."player_id" = p."id"
);
--> statement-breakpoint
-- (3) Drop the old players constraints and columns (IF EXISTS so the drops are
-- safe to replay). These run after the backfill has read the columns.
ALTER TABLE "players" DROP CONSTRAINT IF EXISTS "players_team_jersey_uq";--> statement-breakpoint
ALTER TABLE "players" DROP CONSTRAINT IF EXISTS "players_jersey_range_chk";--> statement-breakpoint
ALTER TABLE "players" DROP CONSTRAINT IF EXISTS "players_team_id_teams_id_fk";--> statement-breakpoint
ALTER TABLE "players" DROP COLUMN IF EXISTS "team_id";--> statement-breakpoint
ALTER TABLE "players" DROP COLUMN IF EXISTS "jersey_number";
