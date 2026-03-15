import { Hono } from "hono";
import { db, sqlClient } from "../database";
import { projects } from "../db/schema";
import { eq, and, isNull, or, lt } from "drizzle-orm";

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
        SELECT ST_TileEnvelope(${z}, ${x}, ${y}) AS bounds
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
            COALESCE(p.tags, ARRAY[]::text[]) AS tags
          FROM projects p, tile_env te
          WHERE p.status = 'approved'
            AND p.geometry IS NOT NULL
            AND ST_Intersects(ST_Transform(p.geometry, 3857), te.bounds)
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
            ST_Y(ST_PointN(ST_ExteriorRing(o.corners), 1)) AS c0_lat,
            ST_X(ST_PointN(ST_ExteriorRing(o.corners), 1)) AS c0_lng,
            ST_Y(ST_PointN(ST_ExteriorRing(o.corners), 2)) AS c1_lat,
            ST_X(ST_PointN(ST_ExteriorRing(o.corners), 2)) AS c1_lng,
            ST_Y(ST_PointN(ST_ExteriorRing(o.corners), 3)) AS c2_lat,
            ST_X(ST_PointN(ST_ExteriorRing(o.corners), 3)) AS c2_lng,
            ST_Y(ST_PointN(ST_ExteriorRing(o.corners), 4)) AS c3_lat,
            ST_X(ST_PointN(ST_ExteriorRing(o.corners), 4)) AS c3_lng
          FROM overlays o, tile_env te
          WHERE o.status = 'approved'
            AND ST_Intersects(ST_Transform(o.corners, 3857), te.bounds)
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
    const rows = await db
      .select({
        id: projects.id,
        lat: projects.lat,
        lng: projects.lng,
        name: projects.name,
        tags: projects.tags,
        geometrySizeM: projects.geometrySizeM,
      })
      .from(projects)
      .where(
        and(
          eq(projects.status, "approved"),
          or(isNull(projects.geometrySizeM), lt(projects.geometrySizeM, 5000)),
        ),
      );

    const features = rows
      .filter((r) => r.lat !== null && r.lng !== null)
      .map((r) => ({
        type: "Feature" as const,
        id: r.id,
        geometry: {
          type: "Point" as const,
          coordinates: [r.lng!, r.lat!],
        },
        properties: {
          id: r.id,
          name: r.name,
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
