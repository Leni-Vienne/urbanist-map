ALTER TABLE "config" ADD COLUMN "report_threshold" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "banned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "banned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "banned_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_banned_by_users_id_fk" FOREIGN KEY ("banned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;