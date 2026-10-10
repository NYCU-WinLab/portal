-- Back to stamping the handwritten signature as a picture (Loki,
-- 2026-10-11): the signing CA, its keys and its revocation trigger go.
DROP TABLE "signing_keys" CASCADE;--> statement-breakpoint
DROP FUNCTION IF EXISTS "signing_keys_revoke_on_leave"();--> statement-breakpoint
ALTER TABLE "trip_files" ADD COLUMN "stamped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Files the CA signed carry the uploader's signature picture when they
-- had one saved and switched on; mark those.
UPDATE "trip_files" SET "stamped" = true
  WHERE "signature_level" IN ('B-LT', 'B-B')
  AND EXISTS (
    SELECT 1 FROM "signatures" s
    WHERE s."user_id" = "trip_files"."user_id" AND s."image" IS NOT NULL AND s."stamp"
  );--> statement-breakpoint
ALTER TABLE "trip_files" DROP COLUMN "signature_level";
