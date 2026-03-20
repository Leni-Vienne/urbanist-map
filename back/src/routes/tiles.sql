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
      p.timeline_status
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
      p.timeline_status
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
    WHEN $1 <= 4 THEN 2048
    WHEN $1 <= 6 THEN 1024
    WHEN $1 <= 8 THEN 512
    WHEN $1 <= 10 THEN 256
    ELSE 128
  END AS cell_size
),
points AS (
  -- Generate the 'project-points' vector tile layer containing center markers for projects
  SELECT ST_AsMVT(q, 'project-points', 4096, 'mvt_geom') AS tile
  FROM (
    -- Deduplicate markers: only keep one representative marker per local grid cell, 
    -- categorized by its primary tag and visual timeline status (so different colored/typed markers don't entirely swallow each other)
    SELECT DISTINCT ON (grid_id, first_tag, timeline_status)
      mvt_geom,
      id,
      name,
      tags,
      first_tag,
      timeline_status,
      has_geometry
    FROM (
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
        -- Calculate the clustering grid cell identifier based on the point's local tile coordinates divided by cell size
        (ST_X(ST_AsMVTGeom(ST_Transform(p.center_coordinate, 3857), te.bounds, 4096, 64, true))::integer / gs.cell_size)::text || '_' || (ST_Y(ST_AsMVTGeom(ST_Transform(p.center_coordinate, 3857), te.bounds, 4096, 64, true))::integer / gs.cell_size)::text as grid_id
      FROM projects p, tile_env te, grid_size gs
      WHERE p.status = 'approved'
        AND p.center_coordinate IS NOT NULL
        AND p.center_coordinate && te.bounds_4326
        -- Hide individual 'building' markers at low zoom levels (<10) to reduce noise
        AND (
          $1 >= 10 OR NOT ('building' = ANY(COALESCE(p.tags, ARRAY[]::text[])))
        )
        -- We don't show center points for physically large features (e.g., roads/lines over 100m) at high zoom levels (>= 11)
        -- because their polygon/line is already visible enough on the map and the central marker just clutters it.
        AND ($1 < 11 OR p.geometry_size_m IS NULL OR p.geometry_size_m < 100)
    ) inner_q
    WHERE inner_q.mvt_geom IS NOT NULL
    ORDER BY grid_id, first_tag, timeline_status, id
  ) q
)
-- Aggregate all three computed tile layers into a single MVT binary payload returned to the client
SELECT (
  (SELECT tile FROM shapes) ||
  (SELECT tile FROM footprints) ||
  (SELECT tile FROM points)
) AS tile;
