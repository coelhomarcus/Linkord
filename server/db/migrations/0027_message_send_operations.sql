CREATE TABLE "message_send_operations" (
	"author_id" text NOT NULL,
	"client_message_id" varchar(64) NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"message_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_send_operations_author_id_client_message_id_pk" PRIMARY KEY("author_id","client_message_id")
);
--> statement-breakpoint
ALTER TABLE "message_send_operations" ADD CONSTRAINT "message_send_operations_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_send_operations" ADD CONSTRAINT "message_send_operations_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_send_operations_created_at_idx" ON "message_send_operations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "message_send_operations_message_id_idx" ON "message_send_operations" USING btree ("message_id");