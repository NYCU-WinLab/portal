CREATE TABLE "room_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text,
	"room" text,
	"date" date NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"title" text NOT NULL,
	"attendees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"online" boolean DEFAULT true NOT NULL,
	"meeting_prefix" text,
	"group_name" text,
	"agenda" text,
	"issue_refs" text[] DEFAULT '{}' NOT NULL,
	"deliverables" text[] DEFAULT '{}' NOT NULL,
	"series_id" uuid,
	"requested_by" uuid NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"invite_sequence" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	CONSTRAINT "room_bookings_status" CHECK ("room_bookings"."status" in ('booked', 'cancelled')),
	CONSTRAINT "room_bookings_room_reserved" CHECK (("room_bookings"."room" is null) = ("room_bookings"."external_id" is null))
);
--> statement-breakpoint
CREATE TABLE "room_daily_runs" (
	"date" date PRIMARY KEY NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_meeting_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"booking_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"callback_token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"stage" text,
	"join_url" text,
	"cancel_id" text,
	"message_id" text,
	"options_applied" boolean,
	"error_code" text,
	"error_message" text,
	"pipeline_id" text,
	"pipeline_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	CONSTRAINT "room_meeting_requests_requestId_unique" UNIQUE("request_id"),
	CONSTRAINT "room_meeting_requests_kind" CHECK ("room_meeting_requests"."kind" in ('create', 'cancel')),
	CONSTRAINT "room_meeting_requests_status" CHECK ("room_meeting_requests"."status" in ('pending', 'success', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "room_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"interval_weeks" smallint DEFAULT 1 NOT NULL,
	"anchor_date" date NOT NULL,
	"attendees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"include_advisor" boolean DEFAULT false NOT NULL,
	"online" boolean DEFAULT true NOT NULL,
	"meeting_prefix" text,
	"group_name" text,
	"agenda" text,
	"issue_refs" text[] DEFAULT '{}' NOT NULL,
	"deliverables" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_series_weekday" CHECK ("room_series"."weekday" between 0 and 6),
	CONSTRAINT "room_series_interval" CHECK ("room_series"."interval_weeks" in (1, 2)),
	CONSTRAINT "room_series_duration" CHECK ("room_series"."duration_minutes" between 30 and 300)
);
--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD COLUMN "reply_to" text;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD COLUMN "ics" text;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD COLUMN "ics_method" text;--> statement-breakpoint
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_series_id_room_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."room_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_meeting_requests" ADD CONSTRAINT "room_meeting_requests_booking_id_room_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."room_bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_series" ADD CONSTRAINT "room_series_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "room_bookings_date_index" ON "room_bookings" USING btree ("date");--> statement-breakpoint
CREATE INDEX "room_bookings_requested_by_index" ON "room_bookings" USING btree ("requested_by");--> statement-breakpoint
CREATE UNIQUE INDEX "room_bookings_series_id_date_index" ON "room_bookings" USING btree ("series_id","date") WHERE "room_bookings"."status" = 'booked' and "room_bookings"."series_id" is not null;--> statement-breakpoint
CREATE INDEX "room_meeting_requests_booking_id_index" ON "room_meeting_requests" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "room_meeting_requests_created_at_index" ON "room_meeting_requests" USING btree ("created_at") WHERE "room_meeting_requests"."status" = 'pending';