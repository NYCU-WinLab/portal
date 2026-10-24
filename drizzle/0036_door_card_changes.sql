CREATE TABLE "door_card_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"card_id" text,
	"user_id" uuid,
	"ok" boolean NOT NULL,
	"error" text,
	"detail" jsonb,
	CONSTRAINT "door_card_changes_action" CHECK ("door_card_changes"."action" in ('add', 'update', 'delete', 'import', 'compare'))
);
--> statement-breakpoint
ALTER TABLE "door_card_changes" ADD CONSTRAINT "door_card_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "door_card_changes_at_index" ON "door_card_changes" USING btree ("at");