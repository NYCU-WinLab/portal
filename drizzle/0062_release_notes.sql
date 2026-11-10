CREATE TABLE "release_notes" (
	"slug" text PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"sha" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "release_reads" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "release_reads" ADD CONSTRAINT "release_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "release_notes_published_at_index" ON "release_notes" USING btree ("published_at");