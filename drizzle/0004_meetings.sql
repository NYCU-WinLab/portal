CREATE TABLE "meeting_questioners" (
	"meeting_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"manual" boolean DEFAULT false NOT NULL,
	CONSTRAINT "meeting_questioners_meeting_id_user_id_pk" PRIMARY KEY("meeting_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"label" text,
	"kind" text DEFAULT 'regular' NOT NULL,
	"holiday" text,
	"presenter_id" uuid,
	"paper_id" uuid,
	"title" text,
	"slides_url" text,
	"recording_url" text,
	"notes" text,
	"location" text DEFAULT 'EC 411' NOT NULL,
	"starts_at" time DEFAULT '15:30' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_date_unique" UNIQUE("date"),
	CONSTRAINT "meetings_kind_known" CHECK ("meetings"."kind" in ('regular', 'holiday', 'speaker', 'thesis')),
	CONSTRAINT "meetings_presenter_kind" CHECK ("meetings"."presenter_id" is null or "meetings"."kind" in ('regular', 'thesis')),
	CONSTRAINT "meetings_paper_kind" CHECK ("meetings"."paper_id" is null or "meetings"."kind" = 'regular')
);
--> statement-breakpoint
CREATE TABLE "papers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"venue" text,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "presenters" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meeting_questioners" ADD CONSTRAINT "meeting_questioners_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_questioners" ADD CONSTRAINT "meeting_questioners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_presenter_id_users_id_fk" FOREIGN KEY ("presenter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "papers" ADD CONSTRAINT "papers_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presenters" ADD CONSTRAINT "presenters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_questioners_user_id_index" ON "meeting_questioners" USING btree ("user_id");