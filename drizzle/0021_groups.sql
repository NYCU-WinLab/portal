CREATE TABLE "group_managers" (
	"group_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_managers_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "group_membership_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"group_id" text NOT NULL,
	"group_email" text NOT NULL,
	"member_email" text NOT NULL,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_membership_audit_action" CHECK ("group_membership_audit"."action" in ('add', 'remove'))
);
--> statement-breakpoint
ALTER TABLE "group_managers" ADD CONSTRAINT "group_managers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_membership_audit" ADD CONSTRAINT "group_membership_audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_membership_audit_group_id_created_at_index" ON "group_membership_audit" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE INDEX "group_membership_audit_actor_id_created_at_index" ON "group_membership_audit" USING btree ("actor_id","created_at");