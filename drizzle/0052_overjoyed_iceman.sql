ALTER TABLE "room_meeting_requests" ADD COLUMN "helper_settled_at" timestamp with time zone;--> statement-breakpoint
-- Pipelines asked before this column existed are not polled.
UPDATE "room_meeting_requests" SET "helper_settled_at" = now() WHERE "helper_pipeline_id" IS NOT NULL;
