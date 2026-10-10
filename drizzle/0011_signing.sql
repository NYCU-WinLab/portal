CREATE TABLE "signing_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid,
	"certificate" "bytea" NOT NULL,
	"private_key" "bytea" NOT NULL,
	"serial" text NOT NULL,
	"not_after" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signing_keys_kind" CHECK ("signing_keys"."kind" in ('root', 'member'))
);
--> statement-breakpoint
ALTER TABLE "trip_files" ADD COLUMN "signature_level" text;--> statement-breakpoint
ALTER TABLE "signing_keys" ADD CONSTRAINT "signing_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signing_keys_one_root" ON "signing_keys" USING btree ("kind") WHERE "signing_keys"."kind" = 'root' and "signing_keys"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "signing_keys_one_per_member" ON "signing_keys" USING btree ("user_id") WHERE "signing_keys"."kind" = 'member' and "signing_keys"."revoked_at" is null;