CREATE TABLE "appointment_schedules" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"windows" jsonb NOT NULL,
	"slot_minutes" integer DEFAULT 30 NOT NULL,
	"ahead_days" integer DEFAULT 14 NOT NULL,
	CONSTRAINT "appointment_schedules_slot" CHECK ("appointment_schedules"."slot_minutes" in (30, 60)),
	CONSTRAINT "appointment_schedules_ahead" CHECK ("appointment_schedules"."ahead_days" between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"booking_id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointment_schedules" ADD CONSTRAINT "appointment_schedules_user_id_calendar_links_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."calendar_links"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_booking_id_room_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."room_bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_owner_id_index" ON "appointments" USING btree ("owner_id");