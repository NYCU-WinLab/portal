CREATE TABLE "door_cards" (
	"card_id" text PRIMARY KEY NOT NULL,
	"holder_name" text NOT NULL,
	"holder_id" uuid,
	"note" text,
	"sync_state" text DEFAULT 'unknown' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "door_cards_card_id" CHECK ("door_cards"."card_id" ~ '^[0-9]{10}$')
);
--> statement-breakpoint
CREATE TABLE "door_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"ok" boolean,
	"error" text,
	"latency_ms" integer,
	"card_id" text,
	"event_code" text,
	"reader" smallint,
	"source_event_id" text,
	"received_at" timestamp with time zone,
	CONSTRAINT "door_events_sourceEventId_unique" UNIQUE("source_event_id"),
	CONSTRAINT "door_events_source" CHECK ("door_events"."source" in ('web', 'mcp', 'card')),
	CONSTRAINT "door_events_card_shape" CHECK (("door_events"."source" = 'card') = ("door_events"."source_event_id" is not null and "door_events"."card_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "door_cards" ADD CONSTRAINT "door_cards_holder_id_users_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "door_events" ADD CONSTRAINT "door_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "door_cards_holder_id_index" ON "door_cards" USING btree ("holder_id");--> statement-breakpoint
CREATE INDEX "door_events_at_index" ON "door_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "door_events_user_id_index" ON "door_events" USING btree ("user_id");