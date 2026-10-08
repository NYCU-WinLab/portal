CREATE TABLE "admins" (
	"user_id" uuid NOT NULL,
	"app" text NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admins_user_id_app_pk" PRIMARY KEY("user_id","app"),
	CONSTRAINT "admins_app_known" CHECK (app in ('portal', 'bento', 'meetings', 'receipts', 'reimburse', 'trip', 'approve', 'door'))
);
--> statement-breakpoint
ALTER TABLE "admins" ADD CONSTRAINT "admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admins" ADD CONSTRAINT "admins_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;