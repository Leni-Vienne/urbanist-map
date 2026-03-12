ALTER TABLE "change_history" ALTER COLUMN "new_value" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "change_requests" ALTER COLUMN "new_value" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "latest_update_on";