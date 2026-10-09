CREATE TABLE "reimburse_egress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid,
	"applicant_name" text NOT NULL,
	"item" text NOT NULL,
	"amount" integer NOT NULL,
	"invoice_date" date NOT NULL,
	"transfer_date" date,
	"transfer_fee" integer DEFAULT 0 NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reimburse_egress_amount" CHECK ("reimburse_egress"."amount" >= 0),
	CONSTRAINT "reimburse_egress_fee" CHECK ("reimburse_egress"."transfer_fee" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reimburse_ingress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"amount" integer NOT NULL,
	"note" text,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reimburse_ingress_amount" CHECK ("reimburse_ingress"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "reimburse_egress" ADD CONSTRAINT "reimburse_egress_applicant_id_users_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimburse_egress" ADD CONSTRAINT "reimburse_egress_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimburse_ingress" ADD CONSTRAINT "reimburse_ingress_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reimburse_egress_invoice_date_index" ON "reimburse_egress" USING btree ("invoice_date");--> statement-breakpoint
CREATE INDEX "reimburse_egress_applicant_id_index" ON "reimburse_egress" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "reimburse_ingress_date_index" ON "reimburse_ingress" USING btree ("date");