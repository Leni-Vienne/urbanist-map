import { Hono } from "hono";
import { sqlClient } from "../database";

export const tilesApp = new Hono();

// GET /api/tiles/projects/:z/:x/:y
// Serves MVT tiles with two layers:
//   - project-shapes: approved project geometry (lines/polygons)
//   - overlay-footprints: approved overlay corners as polygon outlines
tilesApp.get("/projects/:z/:x/:y", async (c) => {
  try {
    const z = parseInt(c.req.param("z"), 10);
    const x = parseInt(c.req.param("x"), 10);
    const y = parseInt(c.req.param("y"), 10);

    if (isNaN(z) || isNaN(x) || isNaN(y) || z < 0 || z > 22 || x < 0 || y < 0) {
      return c.json({ error: "Invalid tile coordinates" }, 400);
    }

    const [row] = await sqlClient`
      WITH tile_env AS (
        SELECT
          ST_TileEnvelope(${z}, ${x}, ${y}) AS bounds,
          ST_Transform(ST_TileEnvelope(${z}, ${x}, ${y}), 4326) AS bounds_4326
      ),
      shapes AS (
        SELECT ST_AsMVT(q, 'project-shapes', 4096, 'mvt_geom') AS tile
        FROM (
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
          WHERE ${z} >= 9
            AND p.status = 'approved'
            AND p.geometry IS NOT NULL 
            AND p.geometry && te.bounds_4326
            
          UNION ALL
          
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
          WHERE ${z} >= 9
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
          WHERE ${z} >= 13
            AND o.status = 'approved'
            AND o.corners && te.bounds_4326
        ) q
        WHERE q.mvt_geom IS NOT NULL
      ),
      points AS (
        SELECT ST_AsMVT(q, 'project-points', 4096, 'mvt_geom') AS tile
        FROM (
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
              (ST_X(ST_AsMVTGeom(ST_Transform(p.center_coordinate, 3857), te.bounds, 4096, 64, true))::integer / 128)::text || '_' || (ST_Y(ST_AsMVTGeom(ST_Transform(p.center_coordinate, 3857), te.bounds, 4096, 64, true))::integer / 128)::text as grid_id
            FROM projects p, tile_env te
            WHERE p.status = 'approved'
              AND p.center_coordinate IS NOT NULL
              AND p.center_coordinate && te.bounds_4326
              AND (
                ${z} >= 11 OR NOT ('building' = ANY(COALESCE(p.tags, ARRAY[]::text[])))
              )
          ) inner_q
          WHERE inner_q.mvt_geom IS NOT NULL
          ORDER BY grid_id, first_tag, timeline_status, id
        ) q
      )
      SELECT (
        (SELECT tile FROM shapes) ||
        (SELECT tile FROM footprints) ||
        (SELECT tile FROM points)
      ) AS tile;
    `;

    const tileData = row?.tile as Buffer | undefined;

    if (!tileData || tileData.length === 0) {
      // Return empty 204 No Content for empty tiles (standard for MVT)
      return new Response(null, { status: 204 });
    }

    return new Response(new Uint8Array(tileData), {
      headers: {
        "Content-Type": "application/vnd.mapbox-vector-tile",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Error generating MVT tile:", error);
    return new Response(JSON.stringify({ error: "Failed to generate MVT tile" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
