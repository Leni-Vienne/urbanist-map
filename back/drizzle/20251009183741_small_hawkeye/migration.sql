ALTER TABLE "projects" RENAME COLUMN "is_marker" TO "is_development";--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "city_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "overlays" DROP COLUMN "metadata";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "metadata";--> statement-breakpoint