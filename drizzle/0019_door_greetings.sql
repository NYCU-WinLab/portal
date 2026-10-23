CREATE TABLE "door_greetings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"suffix" text,
	"sound" "bytea",
	"sound_type" text,
	"sound_version" text,
	"play_sound" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "door_greetings_sound_shape" CHECK (("door_greetings"."sound" is null) = ("door_greetings"."sound_version" is null) and ("door_greetings"."sound" is null) = ("door_greetings"."sound_type" is null))
);
--> statement-breakpoint
ALTER TABLE "door_greetings" ADD CONSTRAINT "door_greetings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;