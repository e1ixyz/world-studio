CREATE TABLE "chat_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"workspace_id" text DEFAULT 'local' NOT NULL,
	"conversation_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"meta" jsonb,
	"ts" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text DEFAULT 'local' NOT NULL,
	"slug" text NOT NULL,
	"session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text DEFAULT 'local' NOT NULL,
	"slug" text NOT NULL,
	"conversation_id" uuid,
	"checkpoint_id" text,
	"prompt" text NOT NULL,
	"runner" text NOT NULL,
	"model" text,
	"engine" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ok" boolean,
	"subtype" text,
	"ms" integer,
	"cost_usd" double precision,
	"denials" jsonb,
	"error" text,
	"stopped" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_items" ADD CONSTRAINT "chat_items_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_items_slug_seq_idx" ON "chat_items" USING btree ("workspace_id","slug","seq");--> statement-breakpoint
CREATE INDEX "conversations_slug_idx" ON "conversations" USING btree ("workspace_id","slug","archived_at");--> statement-breakpoint
CREATE INDEX "runs_slug_idx" ON "runs" USING btree ("workspace_id","slug","started_at");