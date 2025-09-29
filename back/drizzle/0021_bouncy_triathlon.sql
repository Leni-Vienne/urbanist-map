-- AI : Drop old flat coordinate columns (no longer needed)
ALTER TABLE "overlays" DROP COLUMN IF EXISTS "top_left_lat";--> statement-breakpoint
ALTER TABLE "overlays" DROP COLUMN IF EXISTS "top_left_lng";--> statement-breakpoint
ALTER TABLE "overlays" DROP COLUMN IF EXISTS "top_right_lat";--> statement-breakpoint
ALTER TABLE "overlays" DROP COLUMN IF EXISTS "top_right_lng";--> statement-breakpoint
ALTER TABLE "overlays" DROP COLUMN IF EXISTS "bottom_right_lat";--> statement-breakpoint
ALTER TABLE "overlays" DROP COLUMN IF EXISTS "bottom_right_lng";--> statement-breakpoint
ALTER TABLE "overlays" DROP COLUMN IF EXISTS "bottom_left_lat";--> statement-breakpoint
ALTER TABLE "overlays" DROP COLUMN IF EXISTS "bottom_left_lng";--> statement-breakpoint

-- AI : Rename corners_new to corners (preserves data)
ALTER TABLE "overlays" RENAME COLUMN "corners_new" TO "corners";--> statement-breakpoint

-- AI : Update spatial index for renamed column
DROP INDEX IF EXISTS "idx_overlays_corners_new";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_overlays_corners" ON "overlays" USING GIST ("corners");