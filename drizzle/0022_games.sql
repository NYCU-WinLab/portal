CREATE TABLE "game_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"game" text NOT NULL,
	"score" integer NOT NULL,
	"finish_time_ms" integer NOT NULL,
	"level" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_scores_game" CHECK ("game_scores"."game" in ('2048', 'memory', 'typing', 'snake', 'pipes', 'queens'))
);
--> statement-breakpoint
ALTER TABLE "game_scores" ADD CONSTRAINT "game_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_scores_game_level_score_index" ON "game_scores" USING btree ("game","level","score");--> statement-breakpoint
CREATE INDEX "game_scores_user_id_created_at_index" ON "game_scores" USING btree ("user_id","created_at");