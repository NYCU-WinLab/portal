ALTER TABLE "door_tokens" ADD COLUMN "recent_openings" timestamp with time zone[] DEFAULT '{}'::timestamptz[] NOT NULL;--> statement-breakpoint
-- Carry the fixed window's count over, so a key that used its hour just
-- before the deploy stays limited: each opening counted at last_opened_at.
UPDATE "door_tokens" SET "recent_openings" = array_fill("last_opened_at", ARRAY["window_count"]) WHERE "window_started_at" > now() - interval '1 hour' AND "last_opened_at" IS NOT NULL AND "window_count" > 0;
