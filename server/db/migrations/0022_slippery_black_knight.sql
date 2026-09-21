CREATE TABLE "admin_audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"actor_label" text DEFAULT '' NOT NULL,
	"action" varchar(48) NOT NULL,
	"target_type" varchar(16) NOT NULL,
	"target_id" text DEFAULT '' NOT NULL,
	"target_label" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"result" varchar(16) DEFAULT 'ok' NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_audit_result_check" CHECK ("admin_audit_logs"."result" IN ('ok','failed'))
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "status" varchar(16) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "status_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" varchar(16) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "admin_audit_created_id_idx" ON "admin_audit_logs" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "admin_audit_actor_idx" ON "admin_audit_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_target_idx" ON "admin_audit_logs" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_action_idx" ON "admin_audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "conversations_type_status_created_idx" ON "conversations" USING btree ("type","status","created_at","id");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "users_created_at_id_idx" ON "users" USING btree ("created_at","id");