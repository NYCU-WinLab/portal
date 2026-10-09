CREATE TABLE "semesters" (
	"start" date PRIMARY KEY NOT NULL,
	"weeks" integer DEFAULT 16 NOT NULL
);
--> statement-breakpoint
-- Each semester starts on the week that was labelled 第1週 / 第 1 週.
INSERT INTO "semesters" ("start") SELECT "date" FROM "meetings" WHERE "label" ~ '^第\s*1\s*週' ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "meetings" DROP COLUMN "label";