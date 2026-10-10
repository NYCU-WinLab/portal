CREATE TABLE "mail_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to" text[] NOT NULL,
	"subject" text NOT NULL,
	"text" text NOT NULL,
	"html" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "mail_outbox_created_at_index" ON "mail_outbox" USING btree ("created_at") WHERE "mail_outbox"."sent_at" is null;