ALTER TABLE "meetings" ALTER COLUMN "location" SET DEFAULT 'EC411';--> statement-breakpoint
UPDATE "meetings" SET "location" = 'EC411' WHERE "location" = 'EC 411';--> statement-breakpoint
UPDATE "meetings" SET "label" = regexp_replace("label", '^第\s*(\d+)\s*週$', '第 \1 週') WHERE "label" ~ '^第\s*\d+\s*週$';
