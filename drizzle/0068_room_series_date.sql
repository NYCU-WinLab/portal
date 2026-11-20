DROP INDEX "room_bookings_series_id_date_index";--> statement-breakpoint
ALTER TABLE "room_bookings" ADD COLUMN "series_date" date;--> statement-breakpoint
UPDATE "room_bookings" SET "series_date" = "date" WHERE "series_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "room_bookings_series_id_series_date_index" ON "room_bookings" USING btree ("series_id","series_date") WHERE "room_bookings"."status" = 'booked' and "room_bookings"."series_id" is not null;