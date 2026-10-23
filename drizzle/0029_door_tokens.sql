CREATE TABLE "door_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "door_tokens_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "door_events" DROP CONSTRAINT "door_events_source";--> statement-breakpoint
ALTER TABLE "door_events" ADD COLUMN "token_id" uuid;--> statement-breakpoint
ALTER TABLE "door_events" ADD COLUMN "ip" text;--> statement-breakpoint
ALTER TABLE "door_tokens" ADD CONSTRAINT "door_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "door_tokens" ADD CONSTRAINT "door_tokens_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "door_tokens_user_id_index" ON "door_tokens" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "door_events" ADD CONSTRAINT "door_events_token_id_door_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."door_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "door_events_token_id_at_index" ON "door_events" USING btree ("token_id","at");--> statement-breakpoint
ALTER TABLE "door_events" ADD CONSTRAINT "door_events_source" CHECK ("door_events"."source" in ('web', 'mcp', 'api', 'card'));