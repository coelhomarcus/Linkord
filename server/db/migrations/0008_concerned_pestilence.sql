UPDATE "messages" AS "message"
SET "reply_to" = jsonb_strip_nulls(jsonb_build_object(
	'msgId', ("message"."reply_to"->>'msgId')::integer,
	'authorId', "original"."author_id",
	'text', coalesce("message"."reply_to"->>'text', '')
))
FROM "messages" AS "original"
WHERE "message"."reply_to" IS NOT NULL
	AND ("message"."reply_to"->>'msgId') ~ '^[0-9]+$'
	AND "original"."id" = ("message"."reply_to"->>'msgId')::integer;--> statement-breakpoint
UPDATE "messages" AS "message"
SET "reply_to" = jsonb_strip_nulls(jsonb_build_object(
	'msgId', ("message"."reply_to"->>'msgId')::integer,
	'text', coalesce("message"."reply_to"->>'text', '')
))
WHERE "message"."reply_to" IS NOT NULL
	AND ("message"."reply_to"->>'msgId') ~ '^[0-9]+$'
	AND NOT EXISTS (
		SELECT 1
		FROM "messages" AS "original"
		WHERE "original"."id" = ("message"."reply_to"->>'msgId')::integer
	);--> statement-breakpoint
UPDATE "messages"
SET "reply_to" = NULL
WHERE "reply_to" IS NOT NULL
	AND NOT (("reply_to"->>'msgId') ~ '^[0-9]+$');--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "author_name";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "author_avatar";
