-- Parameters:
--   $1 = zoom level (Z)
--   $2 = tile X
--   $3 = tile Y
--   $4 = shapes_min_size_m: minimum geometry_size_m to show a shape at this zoom (NULL = show all)
--   $5 = marker_suppress_min_size_m: minimum geometry_size_m at which the center marker is hidden
--        because its shape is dominant (NULL = never suppress)
--
-- $4 and $5 are pre-computed by the caller (tiles.ts) from the zoom level.
-- Passing them as literal parameters lets the planner pick the appropriate partial GIST index
-- (idx_projects_geometry_Nk) instead of scanning the full geometry index.
WITH tile_env AS (
  -- Calculate the bounding box for the requested tile ($1=Z, $2=X, $3=Y) in Web Mercator (EPSG:3857)
  -- and also transform it to WGS84 (EPSG:4326) for quick intersection checks against table geometries.
  SELECT
    ST_TileEnvelope($1, $2, $3) AS bounds,
    ST_Transform(ST_TileEnvelope($1, $2, $3), 4326) AS bounds_4326
),
shapes AS (
  -- Generate the 'project-shapes' vector tile layer containing physical structures (polygons/lines).
  -- Shapes are gated by both zoom and size to avoid noise in dense areas at mid-zoom.
  -- All zoom values are MapLibre zoom = Leaflet zoom - 1.
  -- The points CTE mirrors these thresholds to hide a center marker once its shape dominates,
  -- EXCEPT the z11 catch-all: small shapes (< 200m) never suppress their marker since they
  -- are too small to be dominant even at close zoom.
  --   z4  (Lft z5):  >= 100 km
  --   z5  (Lft z6):  >= 50 km
  --   z7  (Lft z8):  >= 10 km
  --   z8  (Lft z9):  >= 1 km
  --   z9  (Lft z10): >= 500 m  (shapes visible; marker suppressed only at z11+)
  --   z10 (Lft z11): >= 200 m  (shapes visible; marker suppressed only at z12+)
  --   z11+(Lft z12+): all      (shapes visible; marker suppressed only at z13+)
  SELECT ST_AsMVT(q, 'project-shapes', 4096, 'mvt_geom') AS tile
  FROM (
    -- First part: retrieve projects that have an explicitly drawn geometry (polygon or line)
    SELECT
      ST_AsMVTGeom(
        ST_Transform(p.geometry, 3857),
        te.bounds,
        4096, 64, true
      ) AS mvt_geom,
      p.id,
      p.name,
      COALESCE(p.tags, ARRAY[]::text[]) AS tags,
      COALESCE(p.tags[1], '') AS first_tag,
      p.timeline_status,
      ROUND(p.geometry_size_m)::int AS geometry_size_m,
      CASE WHEN p.name IS NOT NULL AND p.name != '' THEN 1 ELSE 0 END AS is_named,
      EXTRACT(EPOCH FROM COALESCE(p.external_last_modified, p.updated_at))::bigint AS last_modified_s
    FROM projects p, tile_env te
    WHERE $1 >= 4
      AND p.status = 'approved'
      AND p.geometry IS NOT NULL
      AND p.geometry && te.bounds_4326
      AND ($4::float8 IS NULL OR p.geometry_size_m >= $4::float8)

    UNION ALL

    -- Second part: for projects that don't have geometry, we represent them as a single point in the shapes layer
    -- BUT ONLY IF they also do not have any associated image overlays.
    -- This ensures small un-drawn projects are still clickable at high zooms.
    -- These have no meaningful size so they only appear at z8+ (same as before).
    SELECT
      ST_AsMVTGeom(
        ST_Transform(p.center_coordinate, 3857),
        te.bounds,
        4096, 64, true
      ) AS mvt_geom,
      p.id,
      p.name,
      COALESCE(p.tags, ARRAY[]::text[]) AS tags,
      COALESCE(p.tags[1], '') AS first_tag,
      p.timeline_status,
      NULL::int AS geometry_size_m,
      CASE WHEN p.name IS NOT NULL AND p.name != '' THEN 1 ELSE 0 END AS is_named,
      EXTRACT(EPOCH FROM COALESCE(p.external_last_modified, p.updated_at))::bigint AS last_modified_s
    FROM projects p, tile_env te
    WHERE $1 >= 8
      AND p.status = 'approved'
      AND p.geometry IS NULL
      AND p.center_coordinate IS NOT NULL
      AND p.center_coordinate && te.bounds_4326
      AND NOT EXISTS (
        SELECT 1 FROM overlays o WHERE o.project_id = p.id AND o.status = 'approved'
      )
  ) q
  WHERE q.mvt_geom IS NOT NULL
),
footprints AS (
  -- Generate the 'overlay-footprints' vector tile layer showing the bounding box of georeferenced images
  -- This layer is only rendered at zoom level 13 and higher.
  SELECT ST_AsMVT(q, 'overlay-footprints', 4096, 'mvt_geom') AS tile
  FROM (
    SELECT
      ST_AsMVTGeom(
        ST_Transform(o.corners, 3857),
        te.bounds,
        4096, 64, true
      ) AS mvt_geom,
      o.id,
      o.filename,
      o.caption,
      o.project_id,
      COALESCE(p.tags[1], '') AS first_tag,
      p.timeline_status,
      -- Extract the four individual corner latitude and longitude coordinates for rendering the overlay map image on the client
      ST_Y(ST_PointN(ST_ExteriorRing(o.corners), 1)) AS c0_lat,
      ST_X(ST_PointN(ST_ExteriorRing(o.corners), 1)) AS c0_lng,
      ST_Y(ST_PointN(ST_ExteriorRing(o.corners), 2)) AS c1_lat,
      ST_X(ST_PointN(ST_ExteriorRing(o.corners), 2)) AS c1_lng,
      ST_Y(ST_PointN(ST_ExteriorRing(o.corners), 3)) AS c2_lat,
      ST_X(ST_PointN(ST_ExteriorRing(o.corners), 3)) AS c2_lng,
      ST_Y(ST_PointN(ST_ExteriorRing(o.corners), 4)) AS c3_lat,
      ST_X(ST_PointN(ST_ExteriorRing(o.corners), 4)) AS c3_lng
    FROM overlays o
    JOIN projects p ON p.id = o.project_id,
    tile_env te
    WHERE $1 >= 13
      AND o.status = 'approved'
      AND o.corners && te.bounds_4326
  ) q
  WHERE q.mvt_geom IS NOT NULL
),
grid_size AS (
  -- Determine the size of the logical grid used for decluttering (clustering) project markers based on zoom level.
  -- Only powers of 2 that divide 4096 evenly are valid (128, 256, 512, 1024). Non-power-of-2 values
  -- produce partial stub cells at tile edges, causing projects near tile boundaries to fail to cluster
  -- with geographically adjacent projects in the neighbouring tile.
  -- Steps: 1024 → 512 → 256 → 128.
  SELECT CASE
    WHEN $1 <= 4 THEN 1024
    WHEN $1 <= 6 THEN 512
    WHEN $1 <= 10 THEN 256
    ELSE 128
  END AS cell_size
),
points AS (
  -- Generate the 'project-points' vector tile layer containing center markers for projects.
  SELECT ST_AsMVT(q, 'project-points', 4096, 'mvt_geom') AS tile
  FROM (
    -- Step 2: deduplicate — keep one representative project per (grid cell, tag, status) group.
    -- DISTINCT ON picks the first row per group after ORDER BY.
    -- Tiebreaker priority: named projects first, then largest geometry, then most recent.
    -- This makes the representative stable and meaningful rather than arbitrary across zoom transitions.
    -- Window functions compute the size range across ALL projects in the cell, not just the
    -- representative, so the client-side size filter remains accurate for the whole cluster.
    --
    -- At low zoom (tile z < 7, Leaflet z < 8) we collapse the status dimension so that one point
    -- per (cell, tag) is emitted rather than one per (cell, tag, status). This avoids a large
    -- point-count spike caused by e.g. 3 tags × 4 statuses = 12 points per cell. Tag drives
    -- the marker color so color diversity is fully preserved; status dashes only matter once
    -- shapes are visible (z ≥ 7), so nothing meaningful is lost at lower zooms.
    SELECT DISTINCT ON (grid_id, first_tag, CASE WHEN $1 >= 7 THEN timeline_status ELSE '' END)
      mvt_geom,
      id,
      name,
      tags,
      first_tag, -- used for the points/vectors color
      timeline_status,
      has_geometry,
      is_named,
      last_modified_s, -- used for filtering by last modified date
      -- min/max last_modified_s are used for filtering clusters by date on the client
      MIN(last_modified_s) OVER (PARTITION BY grid_id, first_tag, CASE WHEN $1 >= 7 THEN timeline_status ELSE '' END) AS min_last_modified_s,
      MAX(last_modified_s) OVER (PARTITION BY grid_id, first_tag, CASE WHEN $1 >= 7 THEN timeline_status ELSE '' END) AS max_last_modified_s,
      -- geometry_size_m is the representative project's own size.
      -- Used on click to detect when the representative doesn't satisfy the active filter
      -- (e.g. filter=max 5m but representative=74m), so the click handler can avoid
      -- zooming to a location that has no matching projects nearby.
      ROUND(geometry_size_m)::int AS geometry_size_m,
      -- min_size_m and max_size_m span all projects in the cell, used by the client-side
      -- MapLibre filter to decide whether the cluster point should be visible at all.
      ROUND(MIN(geometry_size_m) OVER (PARTITION BY grid_id, first_tag, CASE WHEN $1 >= 7 THEN timeline_status ELSE '' END))::int AS min_size_m,
      ROUND(MAX(geometry_size_m) OVER (PARTITION BY grid_id, first_tag, CASE WHEN $1 >= 7 THEN timeline_status ELSE '' END))::int AS max_size_m,
      -- cell_count is used for determining whether to zoom in on a tile (x > 1) or directly open the project panel (cell_count = 1)
      COUNT(*) OVER (PARTITION BY grid_id, first_tag, CASE WHEN $1 >= 7 THEN timeline_status ELSE '' END)::int AS cell_count
    FROM (
      -- Step 1b: add a per-cell flag indicating whether any non-building project exists in the cell.
      -- Used to suppress building markers at low zoom only when other project types are already visible.
      SELECT
        *,
        BOOL_OR(NOT ('building' = ANY(tags))) OVER (PARTITION BY grid_id) AS cell_has_non_building
      FROM (
        -- Step 1: project all approved markers into tile space and assign each to a grid cell.
        -- grid_id divides the 4096-unit tile into a grid of cell_size squares. At low zoom levels
        -- the cell covers a large geographic area, so many projects share the same cell and only
        -- one representative is surfaced per (cell, tag, status) group after deduplication.
        -- The LATERAL computes ST_AsMVTGeom(ST_Transform(...)) once per row so it is not
        -- redundantly re-evaluated for both mvt_geom and the two components of grid_id.
        SELECT
          mvt.geom AS mvt_geom,
          p.id,
          p.name,
          COALESCE(p.tags, ARRAY[]::text[]) AS tags,
          COALESCE(p.tags[1], '') AS first_tag,
          p.timeline_status,
          CASE WHEN p.geometry IS NOT NULL THEN true ELSE false END AS has_geometry,
          p.geometry_size_m,
          CASE WHEN p.name IS NOT NULL AND p.name != '' THEN 1 ELSE 0 END AS is_named,
          EXTRACT(EPOCH FROM COALESCE(p.external_last_modified, p.updated_at))::bigint AS last_modified_s,
          (ST_X(mvt.geom)::integer / gs.cell_size)::text
            || '_' ||
          (ST_Y(mvt.geom)::integer / gs.cell_size)::text
            AS grid_id
        FROM projects p, tile_env te, grid_size gs
        CROSS JOIN LATERAL (
          SELECT ST_AsMVTGeom(ST_Transform(p.center_coordinate, 3857), te.bounds, 4096, 64, true) AS geom
        ) mvt
        WHERE p.status = 'approved'
          AND p.center_coordinate IS NOT NULL
          AND p.center_coordinate && te.bounds_4326
          -- Hide the center marker once its shape is visible and dominant at this zoom.
          -- $5 is the minimum geometry_size_m at which the shape is considered dominant.
          AND NOT (p.geometry_size_m IS NOT NULL AND $5::float8 IS NOT NULL AND p.geometry_size_m >= $5::float8)
      ) raw_q
    ) inner_q
    WHERE inner_q.mvt_geom IS NOT NULL
      -- At low zoom (<10), hide 'building' markers only in cells that already have non-building projects.
      -- In empty cells (buildings only), show them to avoid blank areas.
      AND ($1 >= 10 OR NOT ('building' = ANY(inner_q.tags)) OR NOT inner_q.cell_has_non_building)
    ORDER BY grid_id, first_tag, CASE WHEN $1 >= 7 THEN timeline_status ELSE '' END, is_named DESC, geometry_size_m DESC NULLS LAST, last_modified_s DESC NULLS LAST
  ) q
)
-- Aggregate all three computed tile layers into a single MVT binary payload returned to the client
SELECT (
  (SELECT tile FROM shapes) ||
  (SELECT tile FROM footprints) ||
  (SELECT tile FROM points)
) AS tile;
