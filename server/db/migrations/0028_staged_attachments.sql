CREATE TABLE "staged_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" bigint NOT NULL,
	"thumb_id" text,
	"thumb_mime_type" text,
	"thumb_size" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "staged_attachments" ADD CONSTRAINT "staged_attachments_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staged_attachments" ADD CONSTRAINT "staged_attachments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staged_attachments_owner_id_idx" ON "staged_attachments" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "staged_attachments_expires_at_idx" ON "staged_attachments" USING btree ("expires_at");