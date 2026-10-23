ALTER TABLE "meetings" RENAME TO "lab_meetings";
--> statement-breakpoint
ALTER TABLE "lab_meetings" RENAME CONSTRAINT "meetings_kind_known" TO "lab_meetings_kind_known";
--> statement-breakpoint
ALTER TABLE "lab_meetings" RENAME CONSTRAINT "meetings_paper_kind" TO "lab_meetings_paper_kind";
--> statement-breakpoint
ALTER TABLE "lab_meetings" RENAME CONSTRAINT "meetings_presenter_kind" TO "lab_meetings_presenter_kind";
--> statement-breakpoint
ALTER TABLE "lab_meetings" RENAME CONSTRAINT "meetings_id_not_null" TO "lab_meetings_id_not_null";
--> statement-breakpoint
ALTER TABLE "lab_meetings" RENAME CONSTRAINT "meetings_date_not_null" TO "lab_meetings_date_not_null";
--> statement-breakpoint
ALTER TABLE "lab_meetings" RENAME CONSTRAINT "meetings_kind_not_null" TO "lab_meetings_kind_not_null";
--> statement-breakpoint
ALTER TABLE "lab_meetings" RENAME CONSTRAINT "meetings_location_not_null" TO "lab_meetings_location_not_null";
--> statement-breakpoint
ALTER TABLE "lab_meetings" RENAME CONSTRAINT "meetings_starts_at_not_null" TO "lab_meetings_starts_at_not_null";
--> statement-breakpoint
ALTER TABLE "lab_meetings" RENAME CONSTRAINT "meetings_created_at_not_null" TO "lab_meetings_created_at_not_null";
--> statement-breakpoint
ALTER TABLE "lab_meetings" RENAME CONSTRAINT "meetings_date_unique" TO "lab_meetings_date_unique";
--> statement-breakpoint
ALTER TABLE "lab_meetings" RENAME CONSTRAINT "meetings_pkey" TO "lab_meetings_pkey";
--> statement-breakpoint
ALTER TABLE "lab_meetings" RENAME CONSTRAINT "meetings_paper_id_papers_id_fk" TO "lab_meetings_paper_id_papers_id_fk";
--> statement-breakpoint
ALTER TABLE "lab_meetings" RENAME CONSTRAINT "meetings_presenter_id_users_id_fk" TO "lab_meetings_presenter_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "meeting_questioners" RENAME TO "lab_meeting_questioners";
--> statement-breakpoint
ALTER TABLE "lab_meeting_questioners" RENAME COLUMN "meeting_id" TO "lab_meeting_id";
--> statement-breakpoint
ALTER TABLE "lab_meeting_questioners" RENAME CONSTRAINT "meeting_questioners_meeting_id_not_null" TO "lab_meeting_questioners_lab_meeting_id_not_null";
--> statement-breakpoint
ALTER TABLE "lab_meeting_questioners" RENAME CONSTRAINT "meeting_questioners_user_id_not_null" TO "lab_meeting_questioners_user_id_not_null";
--> statement-breakpoint
ALTER TABLE "lab_meeting_questioners" RENAME CONSTRAINT "meeting_questioners_manual_not_null" TO "lab_meeting_questioners_manual_not_null";
--> statement-breakpoint
ALTER TABLE "lab_meeting_questioners" RENAME CONSTRAINT "meeting_questioners_meeting_id_user_id_pk" TO "lab_meeting_questioners_lab_meeting_id_user_id_pk";
--> statement-breakpoint
ALTER TABLE "lab_meeting_questioners" RENAME CONSTRAINT "meeting_questioners_meeting_id_meetings_id_fk" TO "lab_meeting_questioners_lab_meeting_id_lab_meetings_id_fk";
--> statement-breakpoint
ALTER TABLE "lab_meeting_questioners" RENAME CONSTRAINT "meeting_questioners_user_id_users_id_fk" TO "lab_meeting_questioners_user_id_users_id_fk";
--> statement-breakpoint
ALTER INDEX "meeting_questioners_user_id_index" RENAME TO "lab_meeting_questioners_user_id_index";
--> statement-breakpoint
ALTER TABLE "meeting_mail_runs" RENAME TO "lab_meeting_mail_runs";
--> statement-breakpoint
ALTER TABLE "lab_meeting_mail_runs" RENAME CONSTRAINT "meeting_mail_runs_date_not_null" TO "lab_meeting_mail_runs_date_not_null";
--> statement-breakpoint
ALTER TABLE "lab_meeting_mail_runs" RENAME CONSTRAINT "meeting_mail_runs_kind_not_null" TO "lab_meeting_mail_runs_kind_not_null";
--> statement-breakpoint
ALTER TABLE "lab_meeting_mail_runs" RENAME CONSTRAINT "meeting_mail_runs_ran_at_not_null" TO "lab_meeting_mail_runs_ran_at_not_null";
--> statement-breakpoint
ALTER TABLE "lab_meeting_mail_runs" RENAME CONSTRAINT "meeting_mail_runs_date_kind_pk" TO "lab_meeting_mail_runs_date_kind_pk";
--> statement-breakpoint
ALTER TABLE "room_series" RENAME TO "standing_meetings";
--> statement-breakpoint
ALTER TABLE "standing_meetings" RENAME CONSTRAINT "room_series_duration" TO "standing_meetings_duration";
--> statement-breakpoint
ALTER TABLE "standing_meetings" RENAME CONSTRAINT "room_series_interval" TO "standing_meetings_interval";
--> statement-breakpoint
ALTER TABLE "standing_meetings" RENAME CONSTRAINT "room_series_weekday" TO "standing_meetings_weekday";
--> statement-breakpoint
ALTER TABLE "standing_meetings" RENAME CONSTRAINT "room_series_id_not_null" TO "standing_meetings_id_not_null";
--> statement-breakpoint
ALTER TABLE "standing_meetings" RENAME CONSTRAINT "room_series_title_not_null" TO "standing_meetings_title_not_null";
--> statement-breakpoint
ALTER TABLE "standing_meetings" RENAME CONSTRAINT "room_series_weekday_not_null" TO "standing_meetings_weekday_not_null";
--> statement-breakpoint
ALTER TABLE "standing_meetings" RENAME CONSTRAINT "room_series_start_time_not_null" TO "standing_meetings_start_time_not_null";
--> statement-breakpoint
ALTER TABLE "standing_meetings" RENAME CONSTRAINT "room_series_duration_minutes_not_null" TO "standing_meetings_duration_minutes_not_null";
--> statement-breakpoint
ALTER TABLE "standing_meetings" RENAME CONSTRAINT "room_series_interval_weeks_not_null" TO "standing_meetings_interval_weeks_not_null";
--> statement-breakpoint
ALTER TABLE "standing_meetings" RENAME CONSTRAINT "room_series_anchor_date_not_null" TO "standing_meetings_anchor_date_not_null";
--> statement-breakpoint
ALTER TABLE "standing_meetings" RENAME CONSTRAINT "room_series_attendees_not_null" TO "standing_meetings_attendees_not_null";
--> statement-breakpoint
ALTER TABLE "standing_meetings" RENAME CONSTRAINT "room_series_include_advisor_not_null" TO "standing_meetings_include_advisor_not_null";
--> statement-breakpoint
ALTER TABLE "standing_meetings" RENAME CONSTRAINT "room_series_online_not_null" TO "standing_meetings_online_not_null";
--> statement-breakpoint
ALTER TABLE "standing_meetings" RENAME CONSTRAINT "room_series_issue_refs_not_null" TO "standing_meetings_issue_refs_not_null";
--> statement-breakpoint
ALTER TABLE "standing_meetings" RENAME CONSTRAINT "room_series_deliverables_not_null" TO "standing_meetings_deliverables_not_null";
--> statement-breakpoint
ALTER TABLE "standing_meetings" RENAME CONSTRAINT "room_series_active_not_null" TO "standing_meetings_active_not_null";
--> statement-breakpoint
ALTER TABLE "standing_meetings" RENAME CONSTRAINT "room_series_created_by_not_null" TO "standing_meetings_created_by_not_null";
--> statement-breakpoint
ALTER TABLE "standing_meetings" RENAME CONSTRAINT "room_series_created_at_not_null" TO "standing_meetings_created_at_not_null";
--> statement-breakpoint
ALTER TABLE "standing_meetings" RENAME CONSTRAINT "room_series_pkey" TO "standing_meetings_pkey";
--> statement-breakpoint
ALTER TABLE "standing_meetings" RENAME CONSTRAINT "room_series_created_by_users_id_fk" TO "standing_meetings_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "room_bookings" RENAME TO "meetings";
--> statement-breakpoint
ALTER TABLE "meetings" RENAME COLUMN "meeting_id" TO "lab_meeting_id";
--> statement-breakpoint
ALTER TABLE "meetings" RENAME CONSTRAINT "room_bookings_room_reserved" TO "meetings_room_reserved";
--> statement-breakpoint
ALTER TABLE "meetings" RENAME CONSTRAINT "room_bookings_status" TO "meetings_status";
--> statement-breakpoint
ALTER TABLE "meetings" RENAME CONSTRAINT "room_bookings_id_not_null" TO "meetings_id_not_null";
--> statement-breakpoint
ALTER TABLE "meetings" RENAME CONSTRAINT "room_bookings_date_not_null" TO "meetings_date_not_null";
--> statement-breakpoint
ALTER TABLE "meetings" RENAME CONSTRAINT "room_bookings_start_time_not_null" TO "meetings_start_time_not_null";
--> statement-breakpoint
ALTER TABLE "meetings" RENAME CONSTRAINT "room_bookings_end_time_not_null" TO "meetings_end_time_not_null";
--> statement-breakpoint
ALTER TABLE "meetings" RENAME CONSTRAINT "room_bookings_title_not_null" TO "meetings_title_not_null";
--> statement-breakpoint
ALTER TABLE "meetings" RENAME CONSTRAINT "room_bookings_attendees_not_null" TO "meetings_attendees_not_null";
--> statement-breakpoint
ALTER TABLE "meetings" RENAME CONSTRAINT "room_bookings_online_not_null" TO "meetings_online_not_null";
--> statement-breakpoint
ALTER TABLE "meetings" RENAME CONSTRAINT "room_bookings_issue_refs_not_null" TO "meetings_issue_refs_not_null";
--> statement-breakpoint
ALTER TABLE "meetings" RENAME CONSTRAINT "room_bookings_deliverables_not_null" TO "meetings_deliverables_not_null";
--> statement-breakpoint
ALTER TABLE "meetings" RENAME CONSTRAINT "room_bookings_requested_by_not_null" TO "meetings_requested_by_not_null";
--> statement-breakpoint
ALTER TABLE "meetings" RENAME CONSTRAINT "room_bookings_status_not_null" TO "meetings_status_not_null";
--> statement-breakpoint
ALTER TABLE "meetings" RENAME CONSTRAINT "room_bookings_invite_sequence_not_null" TO "meetings_invite_sequence_not_null";
--> statement-breakpoint
ALTER TABLE "meetings" RENAME CONSTRAINT "room_bookings_created_at_not_null" TO "meetings_created_at_not_null";
--> statement-breakpoint
ALTER TABLE "meetings" RENAME CONSTRAINT "room_bookings_pkey" TO "meetings_pkey";
--> statement-breakpoint
ALTER TABLE "meetings" RENAME CONSTRAINT "room_bookings_cancelled_by_users_id_fk" TO "meetings_cancelled_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "meetings" RENAME CONSTRAINT "room_bookings_requested_by_users_id_fk" TO "meetings_requested_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "meetings" RENAME CONSTRAINT "room_bookings_series_id_room_series_id_fk" TO "meetings_series_id_standing_meetings_id_fk";
--> statement-breakpoint
ALTER TABLE "meetings" RENAME CONSTRAINT "room_bookings_meeting_id_meetings_id_fk" TO "meetings_lab_meeting_id_lab_meetings_id_fk";
--> statement-breakpoint
ALTER INDEX "room_bookings_date_index" RENAME TO "meetings_date_index";
--> statement-breakpoint
ALTER INDEX "room_bookings_requested_by_index" RENAME TO "meetings_requested_by_index";
--> statement-breakpoint
ALTER INDEX "room_bookings_series_id_date_index" RENAME TO "meetings_series_id_date_index";
--> statement-breakpoint
ALTER INDEX "room_bookings_meeting_id_index" RENAME TO "meetings_lab_meeting_id_index";
--> statement-breakpoint
ALTER TABLE "room_meeting_requests" RENAME TO "teams_requests";
--> statement-breakpoint
ALTER TABLE "teams_requests" RENAME COLUMN "booking_id" TO "meeting_id";
--> statement-breakpoint
ALTER TABLE "teams_requests" RENAME CONSTRAINT "room_meeting_requests_kind" TO "teams_requests_kind";
--> statement-breakpoint
ALTER TABLE "teams_requests" RENAME CONSTRAINT "room_meeting_requests_status" TO "teams_requests_status";
--> statement-breakpoint
ALTER TABLE "teams_requests" RENAME CONSTRAINT "room_meeting_requests_id_not_null" TO "teams_requests_id_not_null";
--> statement-breakpoint
ALTER TABLE "teams_requests" RENAME CONSTRAINT "room_meeting_requests_request_id_not_null" TO "teams_requests_request_id_not_null";
--> statement-breakpoint
ALTER TABLE "teams_requests" RENAME CONSTRAINT "room_meeting_requests_booking_id_not_null" TO "teams_requests_meeting_id_not_null";
--> statement-breakpoint
ALTER TABLE "teams_requests" RENAME CONSTRAINT "room_meeting_requests_kind_not_null" TO "teams_requests_kind_not_null";
--> statement-breakpoint
ALTER TABLE "teams_requests" RENAME CONSTRAINT "room_meeting_requests_callback_token_hash_not_null" TO "teams_requests_callback_token_hash_not_null";
--> statement-breakpoint
ALTER TABLE "teams_requests" RENAME CONSTRAINT "room_meeting_requests_status_not_null" TO "teams_requests_status_not_null";
--> statement-breakpoint
ALTER TABLE "teams_requests" RENAME CONSTRAINT "room_meeting_requests_created_at_not_null" TO "teams_requests_created_at_not_null";
--> statement-breakpoint
ALTER TABLE "teams_requests" RENAME CONSTRAINT "room_meeting_requests_pkey" TO "teams_requests_pkey";
--> statement-breakpoint
ALTER TABLE "teams_requests" RENAME CONSTRAINT "room_meeting_requests_requestId_unique" TO "teams_requests_requestId_unique";
--> statement-breakpoint
ALTER TABLE "teams_requests" RENAME CONSTRAINT "room_meeting_requests_booking_id_room_bookings_id_fk" TO "teams_requests_meeting_id_meetings_id_fk";
--> statement-breakpoint
ALTER INDEX "room_meeting_requests_booking_id_index" RENAME TO "teams_requests_meeting_id_index";
--> statement-breakpoint
ALTER INDEX "room_meeting_requests_created_at_index" RENAME TO "teams_requests_created_at_index";
--> statement-breakpoint
ALTER TABLE "room_daily_runs" RENAME TO "meeting_daily_runs";
--> statement-breakpoint
ALTER TABLE "meeting_daily_runs" RENAME CONSTRAINT "room_daily_runs_date_not_null" TO "meeting_daily_runs_date_not_null";
--> statement-breakpoint
ALTER TABLE "meeting_daily_runs" RENAME CONSTRAINT "room_daily_runs_ran_at_not_null" TO "meeting_daily_runs_ran_at_not_null";
--> statement-breakpoint
ALTER TABLE "meeting_daily_runs" RENAME CONSTRAINT "room_daily_runs_pkey" TO "meeting_daily_runs_pkey";
