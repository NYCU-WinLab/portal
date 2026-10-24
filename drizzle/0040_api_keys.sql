CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"apps" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_opened_at" timestamp with time zone,
	"window_started_at" timestamp with time zone,
	"window_count" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "api_keys_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "door_events" DROP CONSTRAINT "door_events_token_id_door_tokens_id_fk";
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_user_id_index" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
-- Door tokens become API keys allowed into the door, with the same ids,
-- hashes and rate limit; door_tokens stays one release for a rollback.
INSERT INTO "api_keys" ("id", "user_id", "name", "token_hash", "prefix", "apps", "created_at", "last_used_at", "last_opened_at", "window_started_at", "window_count", "revoked_at", "revoked_by")
SELECT "id", "user_id", "name", "token_hash", "prefix", ARRAY['door'], "created_at", "last_used_at", "last_used_at", "window_started_at", "window_count", "revoked_at", "revoked_by" FROM "door_tokens";--> statement-breakpoint
ALTER TABLE "door_events" ADD CONSTRAINT "door_events_token_id_api_keys_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;