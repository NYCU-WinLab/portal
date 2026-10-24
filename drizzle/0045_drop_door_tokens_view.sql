-- The last step of the rename (0043): no running image reads door_tokens
-- or the fixed window columns any more (#167 stopped listing them).
DROP VIEW IF EXISTS "door_tokens";--> statement-breakpoint
ALTER TABLE "api_keys" DROP COLUMN "window_started_at";--> statement-breakpoint
ALTER TABLE "api_keys" DROP COLUMN "window_count";
