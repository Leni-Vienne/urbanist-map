ALTER TABLE "projects" RENAME COLUMN "coordinates" TO "center_coordinate";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "is_development";