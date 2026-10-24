ALTER TABLE "room_meeting_requests" DROP CONSTRAINT "room_meeting_requests_kind";--> statement-breakpoint
ALTER TABLE "room_meeting_requests" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "room_meeting_requests" ADD COLUMN "agenda" text;--> statement-breakpoint
ALTER TABLE "room_meeting_requests" ADD CONSTRAINT "room_meeting_requests_kind" CHECK ("room_meeting_requests"."kind" in ('create', 'update', 'cancel'));