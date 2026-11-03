ALTER TABLE "room_meeting_requests" ADD COLUMN "helper_settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "room_meeting_requests" ADD COLUMN "helper_asked_at" timestamp with time zone;--> statement-breakpoint
-- Pipelines for meetings already over are not polled; later ones are.
UPDATE "room_meeting_requests" AS r SET "helper_settled_at" = now() FROM "room_bookings" AS b WHERE b."id" = r."booking_id" AND r."helper_pipeline_id" IS NOT NULL AND b."date" < (now() AT TIME ZONE 'Asia/Taipei')::date;
