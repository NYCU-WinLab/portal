ALTER TABLE "room_meeting_requests" DROP CONSTRAINT "room_meeting_requests_kind";--> statement-breakpoint
ALTER TABLE "room_meeting_requests" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "room_meeting_requests" ADD COLUMN "agenda" text;--> statement-breakpoint
ALTER TABLE "room_meeting_requests" ADD CONSTRAINT "room_meeting_requests_kind" CHECK ("room_meeting_requests"."kind" in ('create', 'update', 'cancel'));--> statement-breakpoint
-- Creates so far asked for their booking's title, which nothing has renamed yet.
UPDATE "room_meeting_requests" SET "subject" = "room_bookings"."title", "agenda" = "room_bookings"."agenda" FROM "room_bookings" WHERE "room_bookings"."id" = "room_meeting_requests"."booking_id" AND "room_meeting_requests"."kind" = 'create';
