ALTER TABLE "lab_application_events" DROP CONSTRAINT "lab_application_events_kind";--> statement-breakpoint
ALTER TABLE "lab_application_provision_steps" DROP CONSTRAINT "lab_application_provision_steps_step";--> statement-breakpoint
ALTER TABLE "lab_application_provisioning" DROP CONSTRAINT "lab_application_provisioning_released_finished";--> statement-breakpoint
DROP INDEX "lab_application_provisioning_due";--> statement-breakpoint
CREATE INDEX "lab_application_provisioning_due" ON "lab_application_provisioning" USING btree ("next_at") WHERE "lab_application_provisioning"."blocked_at" is null and "lab_application_provisioning"."finished_at" is null;--> statement-breakpoint
ALTER TABLE "lab_application_provisioning" DROP COLUMN "released_at";--> statement-breakpoint
ALTER TABLE "lab_application_events" ADD CONSTRAINT "lab_application_events_kind" CHECK (kind in ('submitted', 'verified', 'edited', 'changes_requested', 'resubmitted', 'accepted', 'provision_step', 'provision_failed', 'provision_blocked', 'provision_retried', 'provisioned', 'rejected', 'withdrawn', 'link_sent', 'password_mail_sent', 'purged'));--> statement-breakpoint
ALTER TABLE "lab_application_provision_steps" ADD CONSTRAINT "lab_application_provision_steps_step" CHECK (step in ('create_account', 'join_mail_groups', 'activate_and_mail', 'finish'));