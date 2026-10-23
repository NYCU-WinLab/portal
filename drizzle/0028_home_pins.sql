CREATE TABLE "home_pins" (
	"user_id" uuid NOT NULL,
	"service" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "home_pins_user_id_service_pk" PRIMARY KEY("user_id","service")
);
--> statement-breakpoint
ALTER TABLE "home_pins" ADD CONSTRAINT "home_pins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;