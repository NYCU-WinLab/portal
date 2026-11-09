CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"google_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"all_day" boolean NOT NULL,
	"title" text NOT NULL,
	"location" text NOT NULL,
	"private" boolean NOT NULL,
	CONSTRAINT "calendar_events_userId_googleId_unique" UNIQUE("user_id","google_id")
);
--> statement-breakpoint
CREATE TABLE "calendar_feeds" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_links" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"google_email" text NOT NULL,
	"refresh_token" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"synced_at" timestamp with time zone,
	"sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_links_visibility" CHECK ("calendar_links"."visibility" in ('private', 'public'))
);
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_calendar_links_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."calendar_links"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_links" ADD CONSTRAINT "calendar_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_events_user_id_starts_at_index" ON "calendar_events" USING btree ("user_id","starts_at");