CREATE TABLE "bento_menu_images" (
	"restaurant_id" uuid PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bento_menu_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"price" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bento_menu_items_price" CHECK ("bento_menu_items"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "bento_option_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"multiple" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bento_option_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"label" text NOT NULL,
	"price_delta" integer DEFAULT 0 NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bento_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"menu_item_id" uuid,
	"name" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"price" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bento_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bento_orders_status" CHECK ("bento_orders"."status" in ('open', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "bento_restaurants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"map_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bento_menu_images" ADD CONSTRAINT "bento_menu_images_restaurant_id_bento_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."bento_restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bento_menu_items" ADD CONSTRAINT "bento_menu_items_restaurant_id_bento_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."bento_restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bento_option_groups" ADD CONSTRAINT "bento_option_groups_restaurant_id_bento_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."bento_restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bento_option_values" ADD CONSTRAINT "bento_option_values_group_id_bento_option_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."bento_option_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bento_order_items" ADD CONSTRAINT "bento_order_items_order_id_bento_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."bento_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bento_order_items" ADD CONSTRAINT "bento_order_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bento_order_items" ADD CONSTRAINT "bento_order_items_menu_item_id_bento_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."bento_menu_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bento_orders" ADD CONSTRAINT "bento_orders_restaurant_id_bento_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."bento_restaurants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bento_orders" ADD CONSTRAINT "bento_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bento_menu_items_restaurant_id_index" ON "bento_menu_items" USING btree ("restaurant_id");--> statement-breakpoint
CREATE INDEX "bento_option_groups_restaurant_id_index" ON "bento_option_groups" USING btree ("restaurant_id");--> statement-breakpoint
CREATE INDEX "bento_option_values_group_id_index" ON "bento_option_values" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "bento_order_items_order_id_index" ON "bento_order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "bento_order_items_user_id_index" ON "bento_order_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bento_orders_date_index" ON "bento_orders" USING btree ("date");