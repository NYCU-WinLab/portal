DROP INDEX "room_bookings_series_id_date_index";--> statement-breakpoint
ALTER TABLE "room_bookings" ADD COLUMN "series_date" date;--> statement-breakpoint
UPDATE "room_bookings" SET "series_date" = "date" WHERE "series_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "room_bookings_series_id_series_date_index" ON "room_bookings" USING btree ("series_id","series_date") WHERE "room_bookings"."status" = 'booked' and "room_bookings"."series_id" is not null;--> statement-breakpoint
-- Code from before this migration, still running while a deploy or a
-- rollback swaps versions, books a week without series_date; the week it
-- stands for is then the day it is held.
CREATE FUNCTION "room_bookings_fill_series_date"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW."series_id" IS NOT NULL AND NEW."series_date" IS NULL THEN
		NEW."series_date" := NEW."date";
	END IF;
	RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "room_bookings_fill_series_date" BEFORE INSERT ON "room_bookings" FOR EACH ROW EXECUTE FUNCTION "room_bookings_fill_series_date"();
