-- A member's signing certificate is revoked when the member is deleted:
-- the foreign key sets user_id to null, and this trigger stamps
-- revoked_at at that moment so /pki/root.crl lists the serial.
CREATE FUNCTION "signing_keys_revoke_on_leave"() RETURNS trigger AS $$
BEGIN
  IF NEW."kind" = 'member' AND OLD."user_id" IS NOT NULL
     AND NEW."user_id" IS NULL AND NEW."revoked_at" IS NULL THEN
    NEW."revoked_at" := now();
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "signing_keys_revoke_on_leave"
  BEFORE UPDATE OF "user_id" ON "signing_keys"
  FOR EACH ROW EXECUTE FUNCTION "signing_keys_revoke_on_leave"();
