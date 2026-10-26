CREATE TABLE "music_lyrics" (
	"video_id" text PRIMARY KEY NOT NULL,
	"synced" text,
	"plain" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "music_lyrics" ADD CONSTRAINT "music_lyrics_video_id_music_tracks_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."music_tracks"("video_id") ON DELETE cascade ON UPDATE no action;