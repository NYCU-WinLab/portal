CREATE TABLE "door_sound_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"starts_at" smallint NOT NULL,
	"ends_at" smallint NOT NULL,
	"days" smallint DEFAULT 127 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sound_ids" uuid[] NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "door_sound_rules_times" CHECK ("door_sound_rules"."starts_at" between 0 and 1439 and "door_sound_rules"."ends_at" between 0 and 1439 and "door_sound_rules"."starts_at" <> "door_sound_rules"."ends_at"),
	CONSTRAINT "door_sound_rules_sounds" CHECK (cardinality("door_sound_rules"."sound_ids") between 1 and 50)
);
--> statement-breakpoint
ALTER TABLE "door_sound_rules" ADD CONSTRAINT "door_sound_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "door_sound_rules" ADD CONSTRAINT "door_sound_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;