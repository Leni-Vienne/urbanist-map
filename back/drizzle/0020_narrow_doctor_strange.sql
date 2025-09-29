-- AI : Add polygon column for storing 4 corner coordinates
ALTER TABLE "overlays" ADD COLUMN "corners_new" geometry(polygon, 4326);

-- AI : Migrate existing data from flat columns to polygon geometry
UPDATE overlays
SET corners_new = ST_GeomFromText(
  'POLYGON((' ||
    top_left_lng || ' ' || top_left_lat || ',' ||
    top_right_lng || ' ' || top_right_lat || ',' ||
    bottom_right_lng || ' ' || bottom_right_lat || ',' ||
    bottom_left_lng || ' ' || bottom_left_lat || ',' ||
    top_left_lng || ' ' || top_left_lat ||
  '))', 4326
)
WHERE corners_new IS NULL;

-- AI : Make corners_new NOT NULL after data migration
ALTER TABLE "overlays" ALTER COLUMN "corners_new" SET NOT NULL;

-- AI : Add spatial index for efficient geometry queries
CREATE INDEX IF NOT EXISTS "idx_overlays_corners_new" ON "overlays" USING GIST ("corners_new");