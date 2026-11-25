CREATE TABLE "application_alerts" (
	"key" text PRIMARY KEY NOT NULL,
	"sent_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_default_mail_groups" (
	"group_id" text PRIMARY KEY NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_mail_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "application_mail_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"recipient_hash" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "application_mail_log_recipient_hash" CHECK (recipient_hash ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "application_mail_log_kind" CHECK (kind in ('verify', 'has_account', 'link'))
);
--> statement-breakpoint
CREATE TABLE "application_notifiees" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_application_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"note" text,
	"requested_by" uuid,
	"requested_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "lab_application_change_requests_due_after_request" CHECK ("lab_application_change_requests"."due_at" > "lab_application_change_requests"."requested_at")
);
--> statement-breakpoint
CREATE TABLE "lab_application_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lab_application_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"application_id" uuid NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" uuid,
	"kind" text NOT NULL,
	"changes" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "lab_application_events_actor_kind" CHECK (actor_kind in ('applicant', 'admin', 'system')),
	CONSTRAINT "lab_application_events_kind" CHECK (kind in ('submitted', 'verified', 'edited', 'changes_requested', 'resubmitted', 'accepted', 'provision_step', 'provision_failed', 'provision_blocked', 'provision_retried', 'provisioned', 'rejected', 'withdrawn', 'link_sent', 'password_mail_requested', 'password_mail_sent', 'password_mail_expired', 'password_set', 'purged')),
	CONSTRAINT "lab_application_events_actor" CHECK ("lab_application_events"."actor_kind" = 'admin' or "lab_application_events"."actor_id" is null)
);
--> statement-breakpoint
CREATE TABLE "lab_application_mail_groups" (
	"application_id" uuid NOT NULL,
	"group_id" text NOT NULL,
	"added_at" timestamp with time zone,
	CONSTRAINT "lab_application_mail_groups_application_id_group_id_pk" PRIMARY KEY("application_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "lab_application_mails" (
	"mail_id" uuid PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"kind" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_application_profiles" (
	"application_id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"chinese_name" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"student_id" text,
	"birthday" date NOT NULL,
	"phone" text NOT NULL,
	"nycu_email" text,
	"department" text NOT NULL,
	"line_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "lab_application_profiles_username" CHECK (username ~ '^[a-z][a-z0-9._-]{2,31}$'),
	CONSTRAINT "lab_application_profiles_chinese_name" CHECK (char_length(chinese_name) between 1 and 32),
	CONSTRAINT "lab_application_profiles_first_name" CHECK (char_length(first_name) between 1 and 64),
	CONSTRAINT "lab_application_profiles_last_name" CHECK (char_length(last_name) between 1 and 64),
	CONSTRAINT "lab_application_profiles_student_id" CHECK (char_length(student_id) between 1 and 16),
	CONSTRAINT "lab_application_profiles_birthday" CHECK (birthday between '1900-01-01' and '2100-01-01'),
	CONSTRAINT "lab_application_profiles_phone" CHECK (phone ~ '^09[0-9]{8}$'),
	CONSTRAINT "lab_application_profiles_nycu_email" CHECK (nycu_email = lower(nycu_email) and char_length(nycu_email) <= 254),
	CONSTRAINT "lab_application_profiles_department" CHECK (char_length(department) between 1 and 64),
	CONSTRAINT "lab_application_profiles_line_id" CHECK (char_length(line_id) between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "lab_application_provision_steps" (
	"application_id" uuid NOT NULL,
	"step" text NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "lab_application_provision_steps_application_id_step_pk" PRIMARY KEY("application_id","step"),
	CONSTRAINT "lab_application_provision_steps_step" CHECK (step in ('create_account', 'join_keycloak_groups', 'join_mail_groups', 'activate_and_mail', 'finish'))
);
--> statement-breakpoint
CREATE TABLE "lab_application_provisioning" (
	"application_id" uuid PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_at" timestamp with time zone NOT NULL,
	"error" text,
	"blocked_at" timestamp with time zone,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	CONSTRAINT "lab_application_provisioning_attempts" CHECK ("lab_application_provisioning"."attempts" >= 0),
	CONSTRAINT "lab_application_provisioning_finished_unblocked" CHECK ("lab_application_provisioning"."finished_at" is null or "lab_application_provisioning"."blocked_at" is null),
	CONSTRAINT "lab_application_provisioning_released_finished" CHECK ("lab_application_provisioning"."released_at" is null or "lab_application_provisioning"."finished_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "lab_application_tokens" (
	"application_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "lab_application_tokens_application_id_purpose_pk" PRIMARY KEY("application_id","purpose"),
	CONSTRAINT "lab_application_tokens_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "lab_application_tokens_purpose" CHECK (purpose in ('verify', 'access')),
	CONSTRAINT "lab_application_tokens_token_hash" CHECK (token_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "lab_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'unverified' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"email" text,
	"requested_status" text NOT NULL,
	"assigned_status" text,
	"assigned_cohort" integer,
	"assigned_username" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"keycloak_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	CONSTRAINT "lab_applications_version" CHECK ("lab_applications"."version" >= 1),
	CONSTRAINT "lab_applications_requested_status" CHECK (requested_status in ('master', 'doctoral')),
	CONSTRAINT "lab_applications_assigned_status" CHECK (assigned_status in ('teacher', 'assistant', 'doctoral', 'master', 'undergrad')),
	CONSTRAINT "lab_applications_assigned_cohort" CHECK (assigned_cohort between 100 and 999),
	CONSTRAINT "lab_applications_assigned_username" CHECK (assigned_username ~ '^[a-z][a-z0-9._-]{2,31}$'),
	CONSTRAINT "lab_applications_status" CHECK (status in ('unverified', 'pending', 'changes_requested', 'provisioning', 'accepted', 'rejected', 'withdrawn')),
	CONSTRAINT "lab_applications_email" CHECK ("lab_applications"."email" = lower("lab_applications"."email") and ("lab_applications"."email" is not null or "lab_applications"."purged_at" is not null)),
	CONSTRAINT "lab_applications_verified" CHECK (("lab_applications"."status" = 'unverified') = ("lab_applications"."verified_at" is null)),
	CONSTRAINT "lab_applications_closed" CHECK ((status in ('accepted', 'rejected', 'withdrawn')) = (closed_at is not null)),
	CONSTRAINT "lab_applications_decided" CHECK ("lab_applications"."status" not in ('provisioning', 'accepted') or ("lab_applications"."assigned_status" is not null and "lab_applications"."assigned_cohort" is not null and "lab_applications"."assigned_username" is not null and "lab_applications"."reviewed_at" is not null)),
	CONSTRAINT "lab_applications_account" CHECK ("lab_applications"."status" <> 'accepted' or "lab_applications"."keycloak_id" is not null),
	CONSTRAINT "lab_applications_purged" CHECK ("lab_applications"."purged_at" is null or ("lab_applications"."closed_at" is not null and "lab_applications"."email" is null and "lab_applications"."review_note" is null))
);
--> statement-breakpoint
ALTER TABLE "admins" DROP CONSTRAINT "admins_app_known";--> statement-breakpoint
ALTER TABLE "application_default_mail_groups" ADD CONSTRAINT "application_default_mail_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_notifiees" ADD CONSTRAINT "application_notifiees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_notifiees" ADD CONSTRAINT "application_notifiees_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_application_change_requests" ADD CONSTRAINT "lab_application_change_requests_application_id_lab_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."lab_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_application_change_requests" ADD CONSTRAINT "lab_application_change_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_application_events" ADD CONSTRAINT "lab_application_events_application_id_lab_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."lab_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_application_events" ADD CONSTRAINT "lab_application_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_application_mail_groups" ADD CONSTRAINT "lab_application_mail_groups_application_id_lab_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."lab_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_application_mails" ADD CONSTRAINT "lab_application_mails_mail_id_mail_outbox_id_fk" FOREIGN KEY ("mail_id") REFERENCES "public"."mail_outbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_application_mails" ADD CONSTRAINT "lab_application_mails_application_id_lab_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."lab_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_application_profiles" ADD CONSTRAINT "lab_application_profiles_application_id_lab_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."lab_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_application_provision_steps" ADD CONSTRAINT "lab_application_provision_steps_application_id_lab_application_provisioning_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."lab_application_provisioning"("application_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_application_provisioning" ADD CONSTRAINT "lab_application_provisioning_application_id_lab_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."lab_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_application_tokens" ADD CONSTRAINT "lab_application_tokens_application_id_lab_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."lab_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_applications" ADD CONSTRAINT "lab_applications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_mail_log_recipient" ON "application_mail_log" USING btree ("recipient_hash","created_at");--> statement-breakpoint
CREATE INDEX "application_mail_log_created" ON "application_mail_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "lab_application_change_requests_application" ON "lab_application_change_requests" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_application_change_requests_open" ON "lab_application_change_requests" USING btree ("application_id") WHERE "lab_application_change_requests"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "lab_application_change_requests_due" ON "lab_application_change_requests" USING btree ("due_at") WHERE "lab_application_change_requests"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "lab_application_events_timeline" ON "lab_application_events" USING btree ("application_id","id");--> statement-breakpoint
CREATE INDEX "lab_application_mails_application" ON "lab_application_mails" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "lab_application_provisioning_due" ON "lab_application_provisioning" USING btree ("next_at") WHERE "lab_application_provisioning"."blocked_at" is null and "lab_application_provisioning"."released_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "lab_applications_active_email" ON "lab_applications" USING btree ("email") WHERE status in ('pending', 'changes_requested', 'provisioning');--> statement-breakpoint
CREATE UNIQUE INDEX "lab_applications_unverified_email" ON "lab_applications" USING btree ("email") WHERE "lab_applications"."status" = 'unverified';--> statement-breakpoint
CREATE UNIQUE INDEX "lab_applications_claimed_username" ON "lab_applications" USING btree ("assigned_username") WHERE "lab_applications"."status" = 'provisioning';--> statement-breakpoint
CREATE INDEX "lab_applications_open" ON "lab_applications" USING btree ("status","created_at") WHERE "lab_applications"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "lab_applications_by_email" ON "lab_applications" USING btree ("email","created_at") WHERE "lab_applications"."email" is not null;--> statement-breakpoint
CREATE INDEX "lab_applications_closed_at" ON "lab_applications" USING btree ("closed_at") WHERE "lab_applications"."closed_at" is not null;--> statement-breakpoint
ALTER TABLE "admins" ADD CONSTRAINT "admins_app_known" CHECK (app in ('portal', 'bento', 'meetings', 'receipts', 'reimburse', 'trip', 'door', 'assets', 'accounts'));