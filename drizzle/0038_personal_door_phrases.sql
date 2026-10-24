ALTER TABLE "door_phrases" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "door_phrases" ADD CONSTRAINT "door_phrases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "door_phrases_user_id_idx" ON "door_phrases" USING btree ("user_id");--> statement-breakpoint
UPDATE "door_phrases" SET "user_id" = "created_by" WHERE "created_by" IS NOT NULL;--> statement-breakpoint
INSERT INTO "door_phrases" ("before", "starts_at", "ends_at") VALUES
	('早安，', 300, 660),
	('午安，', 660, 1080),
	('晚上好，', 1080, 1380),
	('晚安，', 1380, 300);
