WITH tile_env AS (
  -- Calculate the bounding box for the requested tile ($1=Z, $2=X, $3=Y) in Web Mercator (EPSG:3857)
  -- and also transform it to WGS84 (EPSG:4326) for quick intersection checks against table geometries.
  SELECT
    ST_TileEnvelope($1, $2, $3) AS bounds,
    ST_Transform(ST_TileEnvelope($1, $2, $3), 4326) AS bounds_4326
),
shapes AS (
  -- Generate the 'project-shapes' vector tile layer containing physical structures (polygons/lines)
  -- This layer is only rendered at zoom level 9 and higher.
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
    WHERE $1 >= 9
      AND p.status = 'approved'
      AND p.geometry IS NOT NULL
      AND p.geometry && te.bounds_4326

    UNION ALL

    -- Second part: for projects that don'thave geometry, we represent them as a single point in the shapes layer
    -- BUT ONLY IF they also do not have any associated image overlays.
    -- This ensures small un-drawn projects are still clickable at high zooms.
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
    WHERE $1 >= 9
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
  SELECT CASE
    WHEN $1 <= 4 THEN 1024
    WHEN $1 <= 6 THEN 512
    WHEN $1 <= 8 THEN 256
    WHEN $1 <= 10 THEN 192
    ELSE 128
  END AS cell_size
),
points AS (
  -- Generate the 'project-points' vector tile layer containing center markers for projects.
  SELECT ST_AsMVT(q, 'project-points', 4096, 'mvt_geom') AS tile
  FROM (
    -- Step 2: deduplicate — keep one representative project per (grid cell, tag, status) group.
    -- DISTINCT ON picks the first row per group after ORDER BY; with no tiebreaker beyond the
    -- group columns, Postgres picks whichever row it happens to encounter first in its scan,
    -- which is effectively arbitrary and has no geographic bias.
    -- Window functions compute the size range across ALL projects in the cell, not just the
    -- representative, so the client-side size filter remains accurate for the whole cluster.
    SELECT DISTINCT ON (grid_id, first_tag, timeline_status)
      mvt_geom,
      id,
      name,
      tags,
      first_tag, -- used for the points/vectors color
      timeline_status,
      has_geometry,
      is_named,
      last_modified_s, -- used for filtering by last modified date
      -- min_size_m and max_size_m are used for filtering clusters by size on the client
      ROUND(MIN(geometry_size_m) OVER (PARTITION BY grid_id, first_tag, timeline_status))::int AS min_size_m,
      ROUND(MAX(geometry_size_m) OVER (PARTITION BY grid_id, first_tag, timeline_status))::int AS max_size_m,
      -- cell_count is used for determining whether to zoom in on a tile (x > 1)or directly open the project panel (cell_count = 1)
      COUNT(*) OVER (PARTITION BY grid_id, first_tag, timeline_status)::int AS cell_count
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
          CASE WHEN p.geometry IS NOT NULL THEN true ELSE false END AS has_geometry,
          p.geometry_size_m,
          CASE WHEN p.name IS NOT NULL AND p.name != '' THEN 1 ELSE 0 END AS is_named,
          EXTRACT(EPOCH FROM COALESCE(p.external_last_modified, p.updated_at))::bigint AS last_modified_s,
          (ST_X(ST_AsMVTGeom(ST_Transform(p.center_coordinate, 3857), te.bounds, 4096, 64, true))::integer / gs.cell_size)::text
            || '_' ||
          (ST_Y(ST_AsMVTGeom(ST_Transform(p.center_coordinate, 3857), te.bounds, 4096, 64, true))::integer / gs.cell_size)::text
            AS grid_id
        FROM projects p, tile_env te, grid_size gs
        WHERE p.status = 'approved'
          AND p.center_coordinate IS NOT NULL
          AND p.center_coordinate && te.bounds_4326
          -- Hide center points for large geometries progressively as zoom increases,
          -- since their shape is already visible in the shapes layer and the marker just clutters the map.
          AND ($1 < 9  OR p.geometry_size_m IS NULL OR p.geometry_size_m < 50000)
          AND ($1 < 10 OR p.geometry_size_m IS NULL OR p.geometry_size_m < 5000)
          AND ($1 < 11 OR p.geometry_size_m IS NULL OR p.geometry_size_m < 500)
      ) raw_q
    ) inner_q
    WHERE inner_q.mvt_geom IS NOT NULL
      -- At low zoom (<10), hide 'building' markers only in cells that already have non-building projects.
      -- In empty cells (buildings only), show them to avoid blank areas.
      AND ($1 >= 10 OR NOT ('building' = ANY(inner_q.tags)) OR NOT inner_q.cell_has_non_building)
    ORDER BY grid_id, first_tag, timeline_status
  ) q
)
-- Aggregate all three computed tile layers into a single MVT binary payload returned to the client
SELECT (
  (SELECT tile FROM shapes) ||
  (SELECT tile FROM footprints) ||
  (SELECT tile FROM points)
) AS tile;
