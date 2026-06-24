ALTER TABLE "change_requests" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cities" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "countries" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "overlays" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" SET NOT NULL;