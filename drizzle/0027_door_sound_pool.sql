CREATE TABLE "door_playlist_items" (
	"user_id" uuid NOT NULL,
	"sound_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "door_playlist_items_user_id_sound_id_pk" PRIMARY KEY("user_id","sound_id")
);
--> statement-breakpoint
CREATE TABLE "door_sounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"uploader_id" uuid,
	"sound" "bytea" NOT NULL,
	"sound_type" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "door_sounds_label" CHECK (char_length("door_sounds"."label") between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "door_greetings" DROP CONSTRAINT "door_greetings_sound_shape";--> statement-breakpoint
ALTER TABLE "door_playlist_items" ADD CONSTRAINT "door_playlist_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "door_playlist_items" ADD CONSTRAINT "door_playlist_items_sound_id_door_sounds_id_fk" FOREIGN KEY ("sound_id") REFERENCES "public"."door_sounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "door_sounds" ADD CONSTRAINT "door_sounds_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "door_playlist_items_sound_id_index" ON "door_playlist_items" USING btree ("sound_id");--> statement-breakpoint
CREATE INDEX "door_sounds_uploader_id_index" ON "door_sounds" USING btree ("uploader_id");--> statement-breakpoint
-- Each member's own sound joins the pool under their name, and stays on
-- their playlist when it was the one playing.
INSERT INTO "door_sounds" ("label", "uploader_id", "sound", "sound_type", "created_at")
SELECT left(coalesce(nullif(btrim(u."name"), ''), '音效'), 40), g."user_id", g."sound", g."sound_type", g."updated_at"
FROM "door_greetings" g JOIN "users" u ON u."id" = g."user_id"
WHERE g."sound" IS NOT NULL;--> statement-breakpoint
INSERT INTO "door_playlist_items" ("user_id", "sound_id")
SELECT s."uploader_id", s."id"
FROM "door_sounds" s JOIN "door_greetings" g ON g."user_id" = s."uploader_id"
WHERE g."play_sound";--> statement-breakpoint
ALTER TABLE "door_greetings" DROP COLUMN "sound";--> statement-breakpoint
ALTER TABLE "door_greetings" DROP COLUMN "sound_type";--> statement-breakpoint
ALTER TABLE "door_greetings" DROP COLUMN "sound_version";--> statement-breakpoint
ALTER TABLE "door_greetings" DROP COLUMN "play_sound";