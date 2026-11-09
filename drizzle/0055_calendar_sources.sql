CREATE TABLE "calendar_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"google_calendar_id" text,
	"access_role" text,
	"primary" boolean DEFAULT false NOT NULL,
	"url" text,
	"content" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"synced_at" timestamp with time zone,
	"sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_sources_userId_googleCalendarId_unique" UNIQUE("user_id","google_calendar_id"),
	CONSTRAINT "calendar_sources_kind" CHECK (("calendar_sources"."kind" = 'google' and "calendar_sources"."google_calendar_id" is not null)
        or ("calendar_sources"."kind" = 'ics' and "calendar_sources"."url" is not null)
        or ("calendar_sources"."kind" = 'file' and "calendar_sources"."content" is not null)),
	CONSTRAINT "calendar_sources_visibility" CHECK ("calendar_sources"."visibility" in ('private', 'public'))
);
--> statement-breakpoint
ALTER TABLE "calendar_events" DROP CONSTRAINT "calendar_events_userId_googleId_unique";--> statement-breakpoint
ALTER TABLE "calendar_links" DROP CONSTRAINT "calendar_links_visibility";--> statement-breakpoint
ALTER TABLE "appointment_schedules" DROP CONSTRAINT "appointment_schedules_user_id_calendar_links_user_id_fk";
--> statement-breakpoint
ALTER TABLE "calendar_events" DROP CONSTRAINT "calendar_events_user_id_calendar_links_user_id_fk";
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "source_id" uuid;--> statement-breakpoint
-- Each linked account becomes its primary calendar as a source, keeping
-- the account's visibility, and its events move under that source.
INSERT INTO "calendar_sources" ("user_id", "kind", "label", "google_calendar_id", "access_role", "primary", "enabled", "visibility")
SELECT "user_id", 'google', "google_email", "google_email", 'owner', true, true, "visibility" FROM "calendar_links";--> statement-breakpoint
UPDATE "calendar_events" e SET "source_id" = s."id" FROM "calendar_sources" s WHERE s."user_id" = e."user_id" AND s."primary";--> statement-breakpoint
DELETE FROM "calendar_events" WHERE "source_id" IS NULL;--> statement-breakpoint
ALTER TABLE "calendar_events" ALTER COLUMN "source_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_links" ADD COLUMN "scopes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_sources" ADD CONSTRAINT "calendar_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_sources_user_id_index" ON "calendar_sources" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "appointment_schedules" ADD CONSTRAINT "appointment_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_source_id_calendar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."calendar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_links" DROP COLUMN "visibility";--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_sourceId_googleId_unique" UNIQUE("source_id","google_id");