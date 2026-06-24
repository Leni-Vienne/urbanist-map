CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_sessions_expires_at" ON "sessions" USING btree ("expires_at");