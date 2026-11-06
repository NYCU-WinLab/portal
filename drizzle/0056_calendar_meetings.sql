ALTER TABLE "calendar_sources" DROP CONSTRAINT "calendar_sources_kind";--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_sources_one_portal" ON "calendar_sources" USING btree ("user_id") WHERE "calendar_sources"."kind" = 'portal';--> statement-breakpoint
ALTER TABLE "calendar_sources" ADD CONSTRAINT "calendar_sources_kind" CHECK (("calendar_sources"."kind" = 'google' and "calendar_sources"."google_calendar_id" is not null)
        or ("calendar_sources"."kind" = 'ics' and "calendar_sources"."url" is not null)
        or ("calendar_sources"."kind" = 'file' and "calendar_sources"."content" is not null)
        or "calendar_sources"."kind" = 'portal');