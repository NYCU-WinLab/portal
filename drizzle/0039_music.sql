CREATE TABLE "music_activities" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"item_id" uuid,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "music_player" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"volume" real DEFAULT 40 NOT NULL,
	"autoplay" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"position_s" real DEFAULT 0 NOT NULL,
	"position_at" timestamp with time zone,
	"state" text DEFAULT 'idle' NOT NULL,
	"error" text,
	"seen_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "music_queue_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"sort" double precision NOT NULL,
	"added_by" uuid,
	"added_as" text DEFAULT 'queue' NOT NULL,
	"playlist_id" text,
	"resume_at_s" real DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "music_tracks" (
	"video_id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"artist" text DEFAULT '' NOT NULL,
	"duration_s" integer,
	"thumbnail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "music_activities" ADD CONSTRAINT "music_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_activities" ADD CONSTRAINT "music_activities_item_id_music_queue_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."music_queue_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_queue_items" ADD CONSTRAINT "music_queue_items_video_id_music_tracks_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."music_tracks"("video_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_queue_items" ADD CONSTRAINT "music_queue_items_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_queue_items" ADD CONSTRAINT "music_queue_items_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "music_activities_created" ON "music_activities" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "music_queue_items_status_sort" ON "music_queue_items" USING btree ("status","sort");--> statement-breakpoint
CREATE INDEX "music_queue_items_ended" ON "music_queue_items" USING btree ("ended_at");