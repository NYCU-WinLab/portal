CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid NOT NULL,
	"to" text NOT NULL,
	"url" text NOT NULL,
	"outbox_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "invitations_sender_id_created_at_index" ON "invitations" USING btree ("sender_id","created_at");