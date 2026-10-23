CREATE TABLE "meeting_mail_runs" (
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_mail_runs_date_kind_pk" PRIMARY KEY("date","kind")
);
--> statement-breakpoint
ALTER TABLE "room_bookings" ADD COLUMN "meeting_id" uuid;--> statement-breakpoint
ALTER TABLE "room_bookings" ADD COLUMN "place" text;--> statement-breakpoint
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "room_bookings_meeting_id_index" ON "room_bookings" USING btree ("meeting_id") WHERE "room_bookings"."status" = 'booked' and "room_bookings"."meeting_id" is not null;--> statement-breakpoint
-- The Apps Script mailer already sent the week of 2026-10-26.
INSERT INTO "meeting_mail_runs" ("date", "kind") VALUES ('2026-10-26', 'title'), ('2026-10-26', 'announce');
