CREATE TABLE "ip_user_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb,
	"actor_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ip_user_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip" "inet" NOT NULL,
	"user_name" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'unclassified' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "ip_user_entries_ip_unique" UNIQUE("ip"),
	CONSTRAINT "ip_user_entries_category" CHECK ("ip_user_entries"."category" in ('personal', 'shared', 'uncertain', 'experiment', 'empty', 'abnormal', 'unclassified')),
	CONSTRAINT "ip_user_entries_host" CHECK (family("ip_user_entries"."ip") = 4 and masklen("ip_user_entries"."ip") = 32)
);
--> statement-breakpoint
CREATE TABLE "ip_user_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"subnet" "cidr" NOT NULL,
	"gateway" "inet" NOT NULL,
	"dns_servers" "inet"[] DEFAULT '{}' NOT NULL,
	"source_updated_on" date NOT NULL,
	CONSTRAINT "ip_user_settings_single" CHECK ("ip_user_settings"."id"),
	CONSTRAINT "ip_user_settings_gateway_in_subnet" CHECK ("ip_user_settings"."gateway" << "ip_user_settings"."subnet")
);
--> statement-breakpoint
CREATE INDEX "ip_user_changes_entry_id_changed_at_index" ON "ip_user_changes" USING btree ("entry_id","changed_at");