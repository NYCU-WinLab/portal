CREATE TABLE "developer_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"contact_email" text NOT NULL,
	"privacy_url" text NOT NULL,
	"client_type" text NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"approved_scopes" text[] DEFAULT array['profile'] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"secret_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "developer_apps_client" CHECK (("developer_apps"."client_type" = 'public' and "developer_apps"."secret_hash" is null) or ("developer_apps"."client_type" = 'confidential' and "developer_apps"."secret_hash" ~ '^[a-f0-9]{64}$'))
);
--> statement-breakpoint
CREATE TABLE "developer_codes" (
	"hash" text PRIMARY KEY NOT NULL,
	"grant_id" uuid NOT NULL,
	"scopes" text[] NOT NULL,
	"redirect_uri" text NOT NULL,
	"challenge" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "developer_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "developer_scope_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"scopes" text[] NOT NULL,
	"purpose" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "developer_tokens" (
	"access_hash" text PRIMARY KEY NOT NULL,
	"refresh_hash" text NOT NULL,
	"refresh_used" boolean DEFAULT false NOT NULL,
	"grant_id" uuid NOT NULL,
	"scopes" text[] NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "developer_tokens_refreshHash_unique" UNIQUE("refresh_hash")
);
--> statement-breakpoint
ALTER TABLE "developer_apps" ADD CONSTRAINT "developer_apps_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "developer_codes" ADD CONSTRAINT "developer_codes_grant_id_developer_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."developer_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "developer_grants" ADD CONSTRAINT "developer_grants_app_id_developer_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."developer_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "developer_grants" ADD CONSTRAINT "developer_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "developer_scope_requests" ADD CONSTRAINT "developer_scope_requests_app_id_developer_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."developer_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "developer_scope_requests" ADD CONSTRAINT "developer_scope_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "developer_tokens" ADD CONSTRAINT "developer_tokens_grant_id_developer_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."developer_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "developer_apps_owner_id_index" ON "developer_apps" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "developer_codes_grant_id_index" ON "developer_codes" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "developer_grants_app_id_index" ON "developer_grants" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "developer_grants_user_id_index" ON "developer_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "developer_scope_requests_app_id_index" ON "developer_scope_requests" USING btree ("app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "developer_scope_requests_pending_idx" ON "developer_scope_requests" USING btree ("app_id") WHERE "developer_scope_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "developer_tokens_grant_id_index" ON "developer_tokens" USING btree ("grant_id");