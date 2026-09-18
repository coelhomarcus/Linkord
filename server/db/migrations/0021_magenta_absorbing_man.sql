CREATE TABLE "friendships" (
	"id" text PRIMARY KEY NOT NULL,
	"user_low_id" text NOT NULL,
	"user_high_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"retry_after" timestamp with time zone,
	CONSTRAINT "friendships_pair_order_check" CHECK ("friendships"."user_low_id" < "friendships"."user_high_id"),
	CONSTRAINT "friendships_requester_in_pair_check" CHECK ("friendships"."requested_by" = "friendships"."user_low_id" OR "friendships"."requested_by" = "friendships"."user_high_id"),
	CONSTRAINT "friendships_status_check" CHECK ("friendships"."status" IN ('pending','accepted','declined','cancelled','removed'))
);
--> statement-breakpoint
CREATE TABLE "group_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"inviter_id" text NOT NULL,
	"invitee_id" text NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "group_invitations_status_check" CHECK ("group_invitations"."status" IN ('pending','accepted','declined','revoked','expired'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_id" text NOT NULL,
	"kind" varchar(32) NOT NULL,
	"friendship_id" text,
	"group_invitation_id" text,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notifications_kind_reference_check" CHECK (
    ("notifications"."kind" IN ('friend_request','friend_accepted') AND "notifications"."friendship_id" IS NOT NULL AND "notifications"."group_invitation_id" IS NULL)
    OR ("notifications"."kind" = 'group_invitation' AND "notifications"."group_invitation_id" IS NOT NULL AND "notifications"."friendship_id" IS NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" varchar(64) NOT NULL,
	"audience_user_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_blocks" (
	"blocker_id" text NOT NULL,
	"blocked_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "user_blocks_different_users_check" CHECK ("user_blocks"."blocker_id" <> "user_blocks"."blocked_id")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "kind" varchar(16) DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "group_invitation_id" text;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_low_id_users_id_fk" FOREIGN KEY ("user_low_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_high_id_users_id_fk" FOREIGN KEY ("user_high_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_invitee_id_users_id_fk" FOREIGN KEY ("invitee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_friendship_id_friendships_id_fk" FOREIGN KEY ("friendship_id") REFERENCES "public"."friendships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_group_invitation_id_group_invitations_id_fk" FOREIGN KEY ("group_invitation_id") REFERENCES "public"."group_invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_audience_user_id_users_id_fk" FOREIGN KEY ("audience_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "friendships_pair_key" ON "friendships" USING btree ("user_low_id","user_high_id");--> statement-breakpoint
CREATE INDEX "friendships_user_high_id_idx" ON "friendships" USING btree ("user_high_id");--> statement-breakpoint
CREATE INDEX "friendships_status_idx" ON "friendships" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "group_invitations_pending_unique" ON "group_invitations" USING btree ("conversation_id","invitee_id") WHERE "group_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "group_invitations_invitee_status_idx" ON "group_invitations" USING btree ("invitee_id","status");--> statement-breakpoint
CREATE INDEX "group_invitations_conversation_id_idx" ON "group_invitations" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "group_invitations_expires_at_idx" ON "group_invitations" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_key_unique" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_recipient_created_idx" ON "notifications" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_recipient_unread_idx" ON "notifications" USING btree ("recipient_id") WHERE "notifications"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "outbox_events_unprocessed_idx" ON "outbox_events" USING btree ("created_at") WHERE "outbox_events"."processed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "outbox_events_audience_user_id_idx" ON "outbox_events" USING btree ("audience_user_id");--> statement-breakpoint
CREATE INDEX "user_blocks_blocked_id_idx" ON "user_blocks" USING btree ("blocked_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_group_invitation_id_group_invitations_id_fk" FOREIGN KEY ("group_invitation_id") REFERENCES "public"."group_invitations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_group_invitation_id_idx" ON "messages" USING btree ("group_invitation_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_kind_reference_check" CHECK (("messages"."kind" = 'text' AND "messages"."group_invitation_id" IS NULL) OR ("messages"."kind" = 'group_invite'));