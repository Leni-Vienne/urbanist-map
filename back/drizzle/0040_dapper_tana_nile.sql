ALTER TABLE "projects"
  ALTER COLUMN "geometry" SET DATA TYPE geometry(geometrycollection, 4326)
  USING CASE
    WHEN geometry IS NULL THEN NULL
    ELSE ST_SetSRID(ST_GeomFromGeoJSON(geometry::text), 4326)
  END;

-- Spatial index for bbox filtering and MVT tile generation
CREATE INDEX IF NOT EXISTS idx_projects_geometry ON projects USING GIST (geometry);
