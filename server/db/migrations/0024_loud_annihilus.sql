-- IF NOT EXISTS: the legacy repair may have created the table before the migrations ran
CREATE TABLE IF NOT EXISTS "data_repairs" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"kind" varchar(32) NOT NULL,
	"target_type" varchar(16) NOT NULL,
	"target_id" text NOT NULL,
	"before" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"after" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_repairs_run_idx" ON "data_repairs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_repairs_target_idx" ON "data_repairs" USING btree ("target_type","target_id");