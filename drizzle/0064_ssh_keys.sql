CREATE TABLE "ssh_key_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"user_id" uuid,
	"service" text,
	"fingerprint" text,
	CONSTRAINT "ssh_key_changes_action" CHECK ("ssh_key_changes"."action" in ('add_key', 'delete_key', 'use_key', 'unuse_key', 'create_service', 'delete_service', 'rotate_service', 'grant', 'revoke'))
);
--> statement-breakpoint
CREATE TABLE "ssh_key_services" (
	"key_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ssh_key_services_key_id_service_id_pk" PRIMARY KEY("key_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "ssh_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"blob" text NOT NULL,
	"fingerprint" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ssh_keys_userId_fingerprint_unique" UNIQUE("user_id","fingerprint")
);
--> statement-breakpoint
CREATE TABLE "ssh_service_grants" (
	"service_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ssh_service_grants_service_id_user_id_pk" PRIMARY KEY("service_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "ssh_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"open" boolean NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_read_at" timestamp with time zone,
	CONSTRAINT "ssh_services_slug_unique" UNIQUE("slug"),
	CONSTRAINT "ssh_services_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "ssh_services_slug" CHECK ("ssh_services"."slug" ~ '^[a-z0-9][a-z0-9-]{0,31}$')
);
--> statement-breakpoint
ALTER TABLE "ssh_key_changes" ADD CONSTRAINT "ssh_key_changes_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_key_changes" ADD CONSTRAINT "ssh_key_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_key_services" ADD CONSTRAINT "ssh_key_services_key_id_ssh_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."ssh_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_key_services" ADD CONSTRAINT "ssh_key_services_service_id_ssh_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."ssh_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_keys" ADD CONSTRAINT "ssh_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_service_grants" ADD CONSTRAINT "ssh_service_grants_service_id_ssh_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."ssh_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_service_grants" ADD CONSTRAINT "ssh_service_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_service_grants" ADD CONSTRAINT "ssh_service_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_services" ADD CONSTRAINT "ssh_services_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ssh_key_changes_at_index" ON "ssh_key_changes" USING btree ("at");