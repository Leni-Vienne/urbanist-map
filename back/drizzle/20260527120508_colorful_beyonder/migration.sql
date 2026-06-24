ALTER TABLE "users" DROP CONSTRAINT "users_google_id_unique";--> statement-breakpoint
DROP INDEX "idx_users_google_id";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "import_locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "google_id";