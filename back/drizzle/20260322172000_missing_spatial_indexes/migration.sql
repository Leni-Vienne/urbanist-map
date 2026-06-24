CREATE INDEX IF NOT EXISTS idx_projects_center_coordinate ON projects USING GIST (center_coordinate);
-->statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_projects_tags ON projects USING GIN (tags);
-->statement-breakpoint
-- Partial GIST indexes for the shapes layer at low zoom levels.
-- At z4 only geometries >= 100km are shown, but the full geometry index scans 114k rows
-- to find ~36 matching ones. These partial indexes are tiny (364 / 868 / 4724 rows) and
-- let the planner do a near-instant lookup instead of a continent-wide index scan.
-- The query passes the size threshold as a literal parameter ($4) so the planner can
-- infer the partial index predicate and choose the right index automatically.
CREATE INDEX IF NOT EXISTS idx_projects_geometry_100k ON projects USING GIST (geometry) WHERE geometry_size_m >= 100000 AND status = 'approved';
-->statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_projects_geometry_50k ON projects USING GIST (geometry) WHERE geometry_size_m >= 50000 AND status = 'approved';
-->statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_projects_geometry_10k ON projects USING GIST (geometry) WHERE geometry_size_m >= 10000 AND status = 'approved';
