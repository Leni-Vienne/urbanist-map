-- Parameters:
--   $1 = zoom level (Z)
--   $2 = tile X
--   $3 = tile Y
--   $4 = shapes_min_size_m: minimum geometry_size_m to show a shape at this zoom (NULL = show all)
--
-- $4 is pre-computed by the caller (tiles.ts) from the zoom level.
-- Passing it as a literal parameter lets the planner pick the appropriate partial GIST index
-- (idx_projects_geometry_Nk) instead of scanning the full geometry index.
-- The center marker is suppressed inline (see the points CTE) from the same $4 threshold, so a
-- project's marker disappears exactly when its shape becomes visible.
WITH tile_env AS (
  -- Calculate the bounding box for the requested tile ($1=Z, $2=X, $3=Y) in Web Mercator (EPSG:3857)
  -- and also transform it to WGS84 (EPSG:4326) for quick intersection checks against table geometries.
  SELECT
    ST_TileEnvelope($1, $2, $3) AS bounds,
    ST_Transform(ST_TileEnvelope($1, $2, $3), 4326) AS bounds_4326,
    power(2, $1 + 2)::float8 AS grid_scale,
    $2::integer * 4 AS grid_x_offset,
    $3::integer * 4 AS grid_y_offset
),
shapes AS (
  -- Generate the 'project-shapes' vector tile layer containing physical structures (polygons/lines).
  -- Shapes are gated by both zoom and size to avoid noise in dense areas at mid-zoom.
  -- All zoom values are native MapLibre zoom.
  -- The size threshold is passed as $4 (shapes_min_size_m).
  -- Unnamed building shapes are additionally suppressed below z13; named buildings and buildings
  -- >= 1 km follow normal size-based rules (so notable structures are visible at lower zooms).
  SELECT ST_AsMVT(q, 'project-shapes', 4096, 'mvt_geom') AS tile
  FROM (
    -- Projects that have an explicitly drawn geometry (polygon or line). Standalone projects with
    -- no geometry are not emitted here; they carry a center marker via the points layer instead.
    SELECT
      ST_AsMVTGeom(
        ST_Transform(p.geometry, 3857),
        te.bounds,
        4096, 64, true
      ) AS mvt_geom,
      p.id,
      p.name,
      array_to_json(COALESCE(p.tags, ARRAY[]::text[]))::text AS tags,
      COALESCE(p.tags[1], '') AS first_tag,
      p.timeline_status,
      ROUND(p.geometry_size_m)::int AS geometry_size_m,
      CASE WHEN p.name IS NOT NULL AND p.name != '' THEN 1 ELSE 0 END AS is_named,
      EXTRACT(EPOCH FROM COALESCE(p.external_last_modified, p.updated_at))::bigint AS last_modified_s,
      -- Whether this project has at least one approved georeferenced overlay image, so the client
      -- can filter the map down to projects that carry imagery. Renders are excluded: they are not
      -- placed on the map, so they must not flag a project as having map imagery.
      EXISTS (SELECT 1 FROM overlays o WHERE o.project_id = p.id AND o.status = 'approved' AND o.kind = 'map') AS has_image
    FROM projects p, tile_env te
    WHERE $1 >= 4
      AND p.status = 'approved'
      AND p.geometry IS NOT NULL
      AND p.geometry && te.bounds_4326
      AND ($4::float8 IS NULL OR p.geometry_size_m >= $4::float8)
      -- Suppress unnamed building shapes below z13 (MapLibre z12), matching the point-layer suppression
      -- threshold. Named buildings and large buildings (>= 1 km) render at their normal size-based zoom
      -- level, so notable structures (stadiums, hospitals, airports) are discoverable at city zooms.
      AND NOT ($1 <= 12 AND 'building' = ANY(p.tags)
               AND (p.geometry_size_m IS NULL OR p.geometry_size_m < 1000)
               AND (p.name IS NULL OR p.name = ''))
  ) q
  WHERE q.mvt_geom IS NOT NULL
),
footprints AS (
  -- Generate the 'overlay-footprints' vector tile layer showing the bounding box of georeferenced images.
  -- Emitted from z12 so mobile clients (which reveal overlays one zoom level earlier via
  -- getEffectiveThreshold) have footprint geometry to render and hit-test. Desktop clients keep a
  -- z13 layer minzoom, so they ignore the extra z12 data.
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
      p.name,
      array_to_json(COALESCE(p.tags, ARRAY[]::text[]))::text AS tags,
      COALESCE(p.tags[1], '') AS first_tag,
      p.timeline_status,
      -- Used to filter footprints (and their rendered images) by last modified date.
      EXTRACT(EPOCH FROM COALESCE(p.external_last_modified, p.updated_at))::bigint AS last_modified_s,
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
    WHERE $1 >= 12
      AND o.status = 'approved'
      AND o.kind = 'map'
      AND o.corners && te.bounds_4326
  ) q
  WHERE q.mvt_geom IS NOT NULL
),
points AS (
  -- Generate the 'project-points' vector tile layer containing center markers for projects.
  SELECT ST_AsMVT(q, 'project-points', 4096, 'mvt_geom') AS tile
  FROM (
    WITH filtered_q AS MATERIALIZED (
      SELECT
        raw_q.center_coordinate,
        raw_q.id,
        raw_q.name,
        raw_q.tags,
        raw_q.first_tag,
        raw_q.timeline_status,
        raw_q.has_image,
        raw_q.is_named,
        raw_q.last_modified_s,
        raw_q.geometry_size_m,
        raw_q.grid_x,
        raw_q.grid_y,
        (
          (CASE WHEN raw_q.is_named = 1 THEN 100 ELSE 0 END) +
          (CASE WHEN raw_q.has_image THEN 100 ELSE 0 END) +
          (CASE WHEN raw_q.first_tag != '' THEN 50 ELSE 0 END) +
          (CASE WHEN raw_q.geometry_size_m > 0 THEN LN(raw_q.geometry_size_m + 1) * 15 ELSE 0 END)
        )::int AS quality_score
      FROM (
        -- Assign approved markers to the same 1024-unit MVT grid cells without constructing an
        -- MVT geometry for every project. The half-unit offset reproduces ST_AsMVTGeom's integer
        -- coordinate snapping at cell boundaries.
        SELECT
          p.center_coordinate,
          p.id,
          p.name,
          COALESCE(p.tags, ARRAY[]::text[]) AS tags,
          COALESCE(p.tags[1], '') AS first_tag,
          p.timeline_status,
          EXISTS (SELECT 1 FROM overlays o WHERE o.project_id = p.id AND o.status = 'approved' AND o.kind = 'map') AS has_image,
          ROUND(p.geometry_size_m)::int AS geometry_size_m,
          CASE WHEN p.name IS NOT NULL AND p.name != '' THEN 1 ELSE 0 END AS is_named,
          EXTRACT(EPOCH FROM COALESCE(p.external_last_modified, p.updated_at))::bigint AS last_modified_s,
          floor(
            ((ST_X(p.center_coordinate) + 180.0) / 360.0) * te.grid_scale + 1.0 / 2048.0
          )::integer - te.grid_x_offset AS grid_x,
          floor(
            (
              1
              - ln(
                tan(radians(ST_Y(p.center_coordinate)))
                + 1 / cos(radians(ST_Y(p.center_coordinate)))
              ) / pi()
            ) / 2 * te.grid_scale + 1.0 / 2048.0
          )::integer - te.grid_y_offset AS grid_y
        FROM projects p, tile_env te
        WHERE p.status = 'approved'
          AND p.center_coordinate IS NOT NULL
          AND p.center_coordinate && te.bounds_4326
          -- Hide the center marker if its shape is visible at this zoom.
          AND NOT (
            p.geometry IS NOT NULL
            AND ($4::float8 IS NULL OR p.geometry_size_m >= $4::float8)
            AND NOT ($1 <= 12 AND 'building' = ANY(p.tags)
                     AND (p.geometry_size_m IS NULL OR p.geometry_size_m < 1000)
                     AND (p.name IS NULL OR p.name = ''))
          )
        OFFSET 0
      ) raw_q
      WHERE raw_q.center_coordinate IS NOT NULL
    ),
    cluster_agg AS (
      -- Per-cell tag breakdown so the client can show an accurate count when a tag filter is active.
      -- Each count_<tag> is the number of projects in the cell carrying that tag; count_untagged is
      -- the number with no tags (the LEFT JOIN LATERAL emits one NULL row per tagless project).
      -- NULLIF strips zeros so ST_AsMVT omits the column for that feature (lone markers stay cheap).
      SELECT
        f.grid_x,
        f.grid_y,
        ',' || string_agg(DISTINCT t, ',') || ',' AS cluster_tags,
        ',' || string_agg(DISTINCT f.timeline_status, ',') || ',' AS cluster_statuses,
        NULLIF(COUNT(*) FILTER (WHERE t IS NULL), 0) AS count_untagged,
        NULLIF(COUNT(*) FILTER (WHERE t = 'building'), 0) AS count_building,
        NULLIF(COUNT(*) FILTER (WHERE t = 'construction'), 0) AS count_construction,
        NULLIF(COUNT(*) FILTER (WHERE t = 'residential'), 0) AS count_residential,
        NULLIF(COUNT(*) FILTER (WHERE t = 'commercial'), 0) AS count_commercial,
        NULLIF(COUNT(*) FILTER (WHERE t = 'retail'), 0) AS count_retail,
        NULLIF(COUNT(*) FILTER (WHERE t = 'office'), 0) AS count_office,
        NULLIF(COUNT(*) FILTER (WHERE t = 'industrial'), 0) AS count_industrial,
        NULLIF(COUNT(*) FILTER (WHERE t = 'tram'), 0) AS count_tram,
        NULLIF(COUNT(*) FILTER (WHERE t = 'rail'), 0) AS count_rail,
        NULLIF(COUNT(*) FILTER (WHERE t = 'bike'), 0) AS count_bike,
        NULLIF(COUNT(*) FILTER (WHERE t = 'light_rail'), 0) AS count_light_rail,
        NULLIF(COUNT(*) FILTER (WHERE t = 'park'), 0) AS count_park,
        NULLIF(COUNT(*) FILTER (WHERE t = 'road'), 0) AS count_road,
        NULLIF(COUNT(*) FILTER (WHERE t = 'subway'), 0) AS count_subway,
        NULLIF(COUNT(*) FILTER (WHERE t = 'pedestrian'), 0) AS count_pedestrian,
        NULLIF(COUNT(*) FILTER (WHERE t = 'bus'), 0) AS count_bus,
        NULLIF(COUNT(*) FILTER (WHERE t = 'cable_car'), 0) AS count_cable_car,
        NULLIF(COUNT(*) FILTER (WHERE t = 'airport'), 0) AS count_airport,
        NULLIF(COUNT(*) FILTER (WHERE t = 'waterway'), 0) AS count_waterway
      FROM filtered_q f
      LEFT JOIN LATERAL unnest(f.tags) AS t ON true
      GROUP BY f.grid_x, f.grid_y
    ),
    ranked_q AS (
      SELECT
        f.*,
        BOOL_OR(f.has_image) OVER w_cluster AS cluster_has_image,
        MIN(f.last_modified_s) OVER w_cluster AS min_last_modified_s,
        MAX(f.last_modified_s) OVER w_cluster AS max_last_modified_s,
        MIN(f.geometry_size_m) OVER w_cluster AS min_size_m,
        MAX(f.geometry_size_m) OVER w_cluster AS max_size_m,
        (COUNT(*) OVER w_cluster)::int AS cell_count,
        ROW_NUMBER() OVER w_cluster AS representative_rank
      FROM filtered_q f
      WINDOW w_cluster AS (
        PARTITION BY f.grid_x, f.grid_y
        ORDER BY
          f.quality_score DESC,
          f.is_named DESC,
          f.geometry_size_m DESC NULLS LAST,
          f.last_modified_s DESC NULLS LAST
        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
      )
    )
    SELECT
      ST_AsMVTGeom(
        ST_Transform(f.center_coordinate, 3857),
        te.bounds,
        4096, 64, true
      ) AS mvt_geom,
      f.id,
      f.name,
      array_to_json(f.tags)::text AS tags,
      f.first_tag,
      f.timeline_status,
      f.cluster_has_image AS has_image,
      f.is_named,
      f.min_last_modified_s,
      f.max_last_modified_s,
      ca.cluster_tags,
      ca.cluster_statuses,
      ca.count_untagged,
      ca.count_building,
      ca.count_construction,
      ca.count_residential,
      ca.count_commercial,
      ca.count_retail,
      ca.count_office,
      ca.count_industrial,
      ca.count_tram,
      ca.count_rail,
      ca.count_bike,
      ca.count_light_rail,
      ca.count_park,
      ca.count_road,
      ca.count_subway,
      ca.count_pedestrian,
      ca.count_bus,
      ca.count_cable_car,
      ca.count_airport,
      ca.count_waterway,
      f.min_size_m,
      f.max_size_m,
      f.cell_count,
      (f.quality_score >= 150) AS is_high_quality
    FROM ranked_q f
    LEFT JOIN cluster_agg ca
      ON ca.grid_x = f.grid_x
      AND ca.grid_y = f.grid_y
    CROSS JOIN tile_env te
    WHERE f.representative_rank = 1
      AND (
        $1 >= 12 OR
        ($1 >= 10 AND f.quality_score >= 100) OR
        f.quality_score >= 150
      )
  ) q
  WHERE q.mvt_geom IS NOT NULL
)
-- Aggregate all three computed tile layers into a single MVT binary payload returned to the client
SELECT (
  (SELECT tile FROM shapes) ||
  (SELECT tile FROM footprints) ||
  (SELECT tile FROM points)
) AS tile;
