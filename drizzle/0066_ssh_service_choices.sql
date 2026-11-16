CREATE TABLE "ssh_service_choices" (
	"service_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ssh_service_choices_service_id_user_id_pk" PRIMARY KEY("service_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "ssh_service_choices" ADD CONSTRAINT "ssh_service_choices_service_id_ssh_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."ssh_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_service_choices" ADD CONSTRAINT "ssh_service_choices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- A member who already has a key turned on for a service has chosen.
INSERT INTO "ssh_service_choices" ("service_id", "user_id")
SELECT DISTINCT ks."service_id", k."user_id"
FROM "ssh_key_services" ks
JOIN "ssh_keys" k ON k."id" = ks."key_id";
