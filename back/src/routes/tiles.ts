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
              ST_Transform(ST_SetSRID(COALESCE(p.geometry, ST_Point(p.lng, p.lat)), 4326), 3857),
              te.bounds,
              4096, 64, true
            ) AS mvt_geom,
            p.id,
            p.name,
            COALESCE(p.tags, ARRAY[]::text[]) AS tags,
            COALESCE(p.tags[1], '') AS first_tag,
            CASE
              WHEN p.proposal_date IS NOT NULL AND p.start_date IS NULL THEN 1
              ELSE 0
            END AS is_proposed
          FROM projects p, tile_env te
          WHERE p.status = 'approved'
            AND (
              p.geometry IS NOT NULL 
              OR (
                p.lat IS NOT NULL 
                AND p.lng IS NOT NULL 
                AND NOT EXISTS (
                  SELECT 1 FROM overlays o WHERE o.project_id = p.id AND o.status = 'approved'
                )
              )
            )
            AND ST_Intersects(ST_SetSRID(COALESCE(p.geometry, ST_Point(p.lng, p.lat)), 4326), te.bounds_4326)
        ) q
        WHERE q.mvt_geom IS NOT NULL
      ),
      footprints AS (
          SELECT ST_AsMVT(q, 'overlay-footprints', 4096, 'mvt_geom') AS tile
        FROM (
          SELECT
            ST_AsMVTGeom(
              ST_Transform(ST_SetSRID(o.corners, 4326), 3857),
              te.bounds,
              4096, 64, true
            ) AS mvt_geom,
            o.id,
            o.filename,
            o.caption,
            o.project_id,
            COALESCE(p.tags[1], '') AS first_tag,
            CASE
              WHEN p.proposal_date IS NOT NULL AND p.start_date IS NULL THEN 1
              ELSE 0
            END AS is_proposed,
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
          WHERE o.status = 'approved'
            AND ST_Intersects(ST_SetSRID(o.corners, 4326), te.bounds_4326)
        ) q
        WHERE q.mvt_geom IS NOT NULL
      )
      SELECT shapes.tile || footprints.tile AS mvt
      FROM shapes, footprints
    `;

    const mvt: Buffer | null = (row as any)?.mvt ?? null;

    if (!mvt || mvt.length === 0) {
      return new Response(null, { status: 204 });
    }

    return new Response(new Uint8Array(mvt), {
      headers: {
        "Content-Type": "application/x-protobuf",
        "Cache-Control": "public, max-age=300",
        "Content-Encoding": "identity",
      },
    });
  } catch (error) {
    console.error("Tile generation error:", error);
    return c.json({ error: "Failed to generate tile" }, 500);
  }
});

// Exported handler for GET /api/projects/points
// Lightweight GeoJSON FeatureCollection of approved project center coordinates.
// Excludes projects with large geometry (>= 5km bbox diagonal) — those are
// discoverable via the MVT project-shapes layer instead.
// Fully public, aggressively cached.
export async function handleProjectsPoints(): Promise<Response> {
  try {
    // Snap points to a ~500m grid and pick one representative per cell.
    // This drastically reduces the payload when many projects cluster together,
    // without affecting the client-side MapLibre clustering experience.
    const rows = await sqlClient` SELECT  id, lat, lng, COALESCE(tags, ARRAY[]::text[]) AS tags
      FROM projects WHERE status = 'approved' AND lat IS NOT NULL AND lng IS NOT NULL  AND (geometry_size_m IS NULL OR geometry_size_m < 5000)`;
    const features = rows.map((r: any) => ({
      type: "Feature" as const,
      id: r.id,
      geometry: {
        type: "Point" as const,
        coordinates: [Math.round(r.lng * 1e5) / 1e5, Math.round(r.lat * 1e5) / 1e5],
      },
      properties: {
        tags: r.tags ?? [],
      },
    }));

    const geojson = {
      type: "FeatureCollection" as const,
      features,
    };

    return new Response(JSON.stringify(geojson), {
      headers: {
        "Content-Type": "application/geo+json",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (error) {
    console.error("Error fetching project points:", error);
    return new Response(JSON.stringify({ error: "Failed to fetch project points" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
