CREATE TABLE "bento_ratings" (
	"menu_item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bento_ratings_menu_item_id_user_id_pk" PRIMARY KEY("menu_item_id","user_id"),
	CONSTRAINT "bento_ratings_score" CHECK ("bento_ratings"."score" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "bento_ratings" ADD CONSTRAINT "bento_ratings_menu_item_id_bento_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."bento_menu_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bento_ratings" ADD CONSTRAINT "bento_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;