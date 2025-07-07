ALTER TABLE "projects" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "start_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "end_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "latest_update_on" timestamp with time zone;