CREATE TABLE "paper_tag_links" (
	"paper_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "paper_tag_links_paper_id_tag_id_pk" PRIMARY KEY("paper_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "paper_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paper_tag_links" ADD CONSTRAINT "paper_tag_links_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_tag_links" ADD CONSTRAINT "paper_tag_links_tag_id_paper_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."paper_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "paper_tags_name_unique" ON "paper_tags" USING btree (lower("name"));