CREATE TABLE "door_phrases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"before" text DEFAULT '' NOT NULL,
	"after" text DEFAULT '' NOT NULL,
	"starts_at" smallint NOT NULL,
	"ends_at" smallint NOT NULL,
	"days" smallint DEFAULT 127 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "door_phrases_text" CHECK ("door_phrases"."before" <> '' or "door_phrases"."after" <> ''),
	CONSTRAINT "door_phrases_minutes" CHECK ("door_phrases"."starts_at" between 0 and 1439 and "door_phrases"."ends_at" between 0 and 1439 and "door_phrases"."starts_at" <> "door_phrases"."ends_at"),
	CONSTRAINT "door_phrases_days" CHECK ("door_phrases"."days" between 1 and 127)
);
--> statement-breakpoint
CREATE TABLE "door_voice_clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"audio" "bytea" NOT NULL,
	"audio_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "door_voice_clips_text_unique" UNIQUE("text")
);
--> statement-breakpoint
ALTER TABLE "door_phrases" ADD CONSTRAINT "door_phrases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "door_phrases" ADD CONSTRAINT "door_phrases_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;