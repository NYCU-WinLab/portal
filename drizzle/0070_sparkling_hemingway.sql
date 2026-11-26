CREATE TABLE "application_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"apply_site_url" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone,
	CONSTRAINT "application_settings_single_row" CHECK ("application_settings"."id")
);
--> statement-breakpoint
ALTER TABLE "application_settings" ADD CONSTRAINT "application_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;