DROP INDEX "group_invitations_expires_at_idx";--> statement-breakpoint
ALTER TABLE "group_invitations" ALTER COLUMN "expires_at" DROP NOT NULL;--> statement-breakpoint
-- already-lapsed pending invites keep the state people saw; the rest stop expiring
UPDATE "group_invitations" SET "status" = 'expired', "responded_at" = now(), "version" = "version" + 1 WHERE "status" = 'pending' AND "expires_at" <= now();--> statement-breakpoint
UPDATE "group_invitations" SET "expires_at" = NULL WHERE "status" = 'pending';
