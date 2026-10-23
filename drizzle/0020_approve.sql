CREATE TABLE "approve_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"pdf" "bytea",
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "approve_documents_status" CHECK ("approve_documents"."status" in ('draft', 'pending', 'completed'))
);
--> statement-breakpoint
CREATE TABLE "approve_fields" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"signer_id" uuid,
	"page" integer NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"width" double precision NOT NULL,
	"height" double precision NOT NULL,
	"category" text NOT NULL,
	"label" text,
	"value" text,
	"signed_at" timestamp with time zone,
	CONSTRAINT "approve_fields_category" CHECK ("approve_fields"."category" in ('signature', 'contact_address', 'household_address', 'id_number', 'phone', 'other')),
	CONSTRAINT "approve_fields_box" CHECK ("approve_fields"."page" >= 1 and "approve_fields"."x" between 0 and 1 and "approve_fields"."y" between 0 and 1 and "approve_fields"."width" > 0 and "approve_fields"."width" <= 1 and "approve_fields"."height" > 0 and "approve_fields"."height" <= 1)
);
--> statement-breakpoint
CREATE TABLE "approve_saved_values" (
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approve_saved_values_user_id_category_pk" PRIMARY KEY("user_id","category")
);
--> statement-breakpoint
CREATE TABLE "approve_signers" (
	"document_id" uuid NOT NULL,
	"signer_id" uuid NOT NULL,
	"signed_at" timestamp with time zone,
	CONSTRAINT "approve_signers_document_id_signer_id_pk" PRIMARY KEY("document_id","signer_id")
);
--> statement-breakpoint
ALTER TABLE "approve_documents" ADD CONSTRAINT "approve_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approve_fields" ADD CONSTRAINT "approve_fields_document_id_approve_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."approve_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approve_fields" ADD CONSTRAINT "approve_fields_signer_id_users_id_fk" FOREIGN KEY ("signer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approve_saved_values" ADD CONSTRAINT "approve_saved_values_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approve_signers" ADD CONSTRAINT "approve_signers_document_id_approve_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."approve_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approve_signers" ADD CONSTRAINT "approve_signers_signer_id_users_id_fk" FOREIGN KEY ("signer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approve_documents_created_by_index" ON "approve_documents" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "approve_fields_document_id_index" ON "approve_fields" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "approve_signers_signer_id_index" ON "approve_signers" USING btree ("signer_id");