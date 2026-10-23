ALTER TABLE "door_sounds" ADD COLUMN "version" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
UPDATE "door_sounds" SET "version" = "id";
