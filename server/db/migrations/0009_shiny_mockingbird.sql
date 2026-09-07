ALTER TABLE "users" ADD COLUMN "banner" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bio" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profile_links" jsonb DEFAULT '[]'::jsonb NOT NULL;