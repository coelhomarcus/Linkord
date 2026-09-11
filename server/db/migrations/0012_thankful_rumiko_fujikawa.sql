ALTER TABLE "categories" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "channels" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "categories" CASCADE;--> statement-breakpoint
DROP TABLE "channels" CASCADE;--> statement-breakpoint
DROP INDEX "messages_channel_id_idx";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "channel_id";