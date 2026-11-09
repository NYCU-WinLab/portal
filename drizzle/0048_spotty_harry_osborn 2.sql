ALTER TABLE "room_meeting_requests" ADD COLUMN "helper_pipeline_id" text;--> statement-breakpoint
ALTER TABLE "room_meeting_requests" ADD COLUMN "helper_error" text;--> statement-breakpoint
ALTER TABLE "room_meeting_requests" ADD COLUMN "helper_tries" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "room_meeting_requests" ADD COLUMN "helper_notified_at" timestamp with time zone;