CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"project" text,
	"deposit_account" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"uploader_id" uuid,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"mail_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_status" CHECK ("receipts"."status" in ('pending', 'approved')),
	CONSTRAINT "receipts_deposit_account" CHECK ("receipts"."deposit_account" in ('post', 'esun'))
);
--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_mail_id_mail_outbox_id_fk" FOREIGN KEY ("mail_id") REFERENCES "public"."mail_outbox"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipts_created_at_index" ON "receipts" USING btree ("created_at");