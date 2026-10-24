-- Run before rolling the portal back past migration 0038 (personal door
-- phrases). Older images read every door_phrases row as the lab's pool, so
-- members' own phrases would be said to everyone. This keeps them in a
-- backup table, drops them and the 4 defaults 0038 added, and removes the
-- column and its migration record.
BEGIN;
CREATE TABLE door_phrases_personal_backup AS
  SELECT * FROM door_phrases WHERE user_id IS NOT NULL;
DELETE FROM door_phrases WHERE user_id IS NOT NULL;
DELETE FROM door_phrases
  WHERE user_id IS NULL AND created_by IS NULL AND after = ''
    AND (before, starts_at, ends_at) IN
      (('早安，', 300, 660), ('午安，', 660, 1080),
       ('晚上好，', 1080, 1380), ('晚安，', 1380, 300));
ALTER TABLE door_phrases DROP COLUMN user_id;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1792826334201;
COMMIT;
