-- Door tokens became API keys (0040); the table takes their name. Renames
-- keep the rows, indexes and constraints as they are.
ALTER TABLE "door_tokens" RENAME TO "api_keys";--> statement-breakpoint
ALTER TABLE "api_keys" RENAME CONSTRAINT "door_tokens_pkey" TO "api_keys_pkey";--> statement-breakpoint
ALTER TABLE "api_keys" RENAME CONSTRAINT "door_tokens_tokenHash_unique" TO "api_keys_tokenHash_unique";--> statement-breakpoint
ALTER TABLE "api_keys" RENAME CONSTRAINT "door_tokens_user_id_users_id_fk" TO "api_keys_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "api_keys" RENAME CONSTRAINT "door_tokens_revoked_by_users_id_fk" TO "api_keys_revoked_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "door_events" RENAME CONSTRAINT "door_events_token_id_door_tokens_id_fk" TO "door_events_token_id_api_keys_id_fk";--> statement-breakpoint
ALTER INDEX "door_tokens_user_id_index" RENAME TO "api_keys_user_id_index";--> statement-breakpoint
-- The previous release still reads and writes door_tokens: a plain view is
-- updatable, so a rollback keeps working. Dropped in the next release.
CREATE VIEW "door_tokens" AS SELECT * FROM "api_keys";
