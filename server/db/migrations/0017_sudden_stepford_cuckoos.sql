CREATE TABLE "message_reactions" (
	"message_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"emoji" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_reactions_message_id_user_id_emoji_pk" PRIMARY KEY("message_id","user_id","emoji")
);
--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_reactions_message_id_idx" ON "message_reactions" USING btree ("message_id");--> statement-breakpoint
INSERT INTO "message_reactions" ("message_id", "user_id", "emoji")
SELECT m.id, uid.value, kv.key
FROM "messages" m,
     jsonb_each(m.reactions) AS kv,
     jsonb_array_elements_text(kv.value) AS uid(value)
ON CONFLICT ("message_id", "user_id", "emoji") DO NOTHING;--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "reactions";