-- get_member_avatar moved from the profile app to its own avatars app.
-- Keys that could read avatars through profile keep that right, and
-- viewer.winlab.tw's service key gains it for its presence avatars.
UPDATE "api_keys" SET "apps" = array_append("apps", 'avatars')
  WHERE 'profile' = ANY("apps") AND NOT 'avatars' = ANY("apps");--> statement-breakpoint
UPDATE "service_keys" SET "apps" = array_append("apps", 'avatars')
  WHERE "service" = 'viewer.winlab.tw' AND "revoked_at" IS NULL
    AND NOT 'avatars' = ANY("apps");
