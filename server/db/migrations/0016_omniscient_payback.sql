ALTER TABLE "attachments" ADD COLUMN "thumb_id" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "is_thumbnail" boolean DEFAULT false NOT NULL;