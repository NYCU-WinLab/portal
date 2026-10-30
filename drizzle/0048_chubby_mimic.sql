CREATE TABLE "music_likes" (
	"user_id" uuid NOT NULL,
	"video_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "music_likes_user_id_video_id_pk" PRIMARY KEY("user_id","video_id")
);
--> statement-breakpoint
ALTER TABLE "music_likes" ADD CONSTRAINT "music_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_likes" ADD CONSTRAINT "music_likes_video_id_music_tracks_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."music_tracks"("video_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "music_likes_user_created" ON "music_likes" USING btree ("user_id","created_at");