ALTER TABLE "door_tokens" ADD COLUMN "apps" text[] DEFAULT '{door}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "door_tokens" ADD COLUMN "last_opened_at" timestamp with time zone;--> statement-breakpoint
-- Door tokens spaced openings by last_used_at; API keys use that for any
-- call, and last_opened_at for openings.
UPDATE "door_tokens" SET "last_opened_at" = "last_used_at";
