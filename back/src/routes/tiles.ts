import { Hono } from "hono";
import { tilesSqlClient, db } from "../database"; // client with jit=off and work_mem=128MB
import { projects, overlays } from "../db/schema";
import { eq } from "drizzle-orm";

export const tilesApp = new Hono();

// ---------------------------------------------------------------------------
// In-memory LRU tile cache (low-zoom tiles only, z <= 6)
// null = empty tile (204), Buffer = tile data
// ---------------------------------------------------------------------------
const TILE_CACHE_MAX = 6000;
const LOW_ZOOM_MAX = 6;

// Map insertion order = LRU order (oldest first)
const tileCache = new Map<string, Buffer | null>();

export function clearTileCache() {
  tileCache.clear();
}

function lngLatToTileXY(lng: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return [x, Math.max(0, Math.min(n - 1, y))];
}

// Evicts the single tile at each zoom level z0..LOW_ZOOM_MAX that contains the given point.
function invalidateTilesForPoint(lat: number, lng: number) {
  for (let z = 0; z <= LOW_ZOOM_MAX; z += 1) {
    const [x, y] = lngLatToTileXY(lng, lat, z);
    tileCache.delete(`${z}/${x}/${y}`);
  }
}

function getCachedTile(key: string): Buffer | null | undefined {
  if (!tileCache.has(key)) return undefined;
  const val = tileCache.get(key)!;
  // Promote to end (most recently used)
  tileCache.delete(key);
  tileCache.set(key, val);
  return val;
}

function setCachedTile(key: string, val: Buffer | null) {
  if (tileCache.size >= TILE_CACHE_MAX) {
    tileCache.delete(tileCache.keys().next().value!);
  }
  tileCache.set(key, val);
}

export async function invalidateProjectTiles(projectId: string) {
  try {
    const [row] = await db
      .select({ lat: projects.lat, lng: projects.lng })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (
      row?.lat !== null &&
      row?.lat !== undefined &&
      row?.lng !== null &&
      row?.lng !== undefined
    ) {
      invalidateTilesForPoint(row.lat, row.lng);
    } else {
      clearTileCache();
    }
  } catch {
    clearTileCache();
  }
}

export async function invalidateOverlayTiles(overlayId: string) {
  try {
    const [row] = await db
      .select({ lat: projects.lat, lng: projects.lng })
      .from(overlays)
      .innerJoin(projects, eq(overlays.projectId, projects.id))
      .where(eq(overlays.id, overlayId))
      .limit(1);
    if (
      row?.lat !== null &&
      row?.lat !== undefined &&
      row?.lng !== null &&
      row?.lng !== undefined
    ) {
      invalidateTilesForPoint(row.lat, row.lng);
    } else {
      clearTileCache();
    }
  } catch {
    clearTileCache();
  }
}

// Minimum geometry_size_m to show a shape at a given zoom level.
// NULL means show all shapes (no size gate).
// Passed as $4 to tiles.sql so the planner can use partial GIST indexes.
function shapesMinSizeM(z: number): number | null {
  if (z >= 11) return null;
  if (z >= 10) return 200;
  if (z >= 9) return 500;
  if (z >= 8) return 1000;
  if (z >= 7) return 10_000;
  if (z >= 5) return 50_000;
  return 100_000; // z3-z4
  // not including lower zoom levels because in dense area like China it gets messy
}

// Minimum geometry_size_m at which the center-point marker is suppressed because
// the shape is large enough to be dominant at this zoom.
// NULL means never suppress markers (shape layer not active at this zoom).
// Passed as $5 to tiles.sql so the planner can use partial GIST indexes.
function markerSuppressMinSizeM(z: number): number | null {
  if (z >= 13) return 200;
  if (z >= 12) return 500;
  if (z >= 11) return 1000;
  if (z >= 7) return 10_000;
  if (z >= 5) return 50_000;
  if (z >= 4) return 100_000;
  return null;
}

// GET /api/tiles/projects/:z/:x/:y
// Serves MVT tiles with two layers:
//   - project-shapes: approved project geometry (lines/polygons)
//   - overlay-footprints: approved overlay corners as polygon outlines
tilesApp.get("/projects/:z/:x/:y", async (c) => {
  try {
    const z = Number.parseInt(c.req.param("z"), 10);
    const x = Number.parseInt(c.req.param("x"), 10);
    const y = Number.parseInt(c.req.param("y"), 10);

    if (
      Number.isNaN(z) ||
      Number.isNaN(x) ||
      Number.isNaN(y) ||
      z < 0 ||
      z > 22 ||
      x < 0 ||
      y < 0
    ) {
      return c.json({ error: "Invalid tile coordinates" }, 400);
    }

    const cacheKey = `${z}/${x}/${y}`;
    const useCache = z <= LOW_ZOOM_MAX;

    if (useCache) {
      const cached = getCachedTile(cacheKey);
      if (cached !== undefined) {
        if (cached === null) return new Response(null, { status: 204 });
        return new Response(new Uint8Array(cached), {
          headers: {
            "Content-Type": "application/vnd.mapbox-vector-tile",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=86400",
          },
        });
      }
    }

    // using the jit=off + work_mem=128MB client
    // In Docker prod, import.meta.dir points to /app (bundle location), so use /app/routes
    // In dev, it points to the source directory where tiles.sql lives
    const sqlPath =
      process.env.NODE_ENV === "production"
        ? "/app/routes/tiles.sql"
        : `${import.meta.dir}/tiles.sql`;
    const [row] = await tilesSqlClient.file(sqlPath, [
      z,
      x,
      y,
      shapesMinSizeM(z),
      markerSuppressMinSizeM(z),
    ]);

    const tileData = row?.tile as Buffer | undefined;

    if (!tileData || tileData.length === 0) {
      if (useCache) setCachedTile(cacheKey, null);
      // Return empty 204 No Content for empty tiles (standard for MVT)
      return new Response(null, { status: 204 });
    }

    if (useCache) setCachedTile(cacheKey, tileData);

    return new Response(new Uint8Array(tileData), {
      headers: {
        "Content-Type": "application/vnd.mapbox-vector-tile",
        "Access-Control-Allow-Origin": "*",
        // Low-zoom tiles (z0-z6) contain only OSM-imported data that changes at most
        // monthly, so cache them aggressively. High-zoom tiles may include freshly
        // approved overlays, so keep their TTL short.
        "Cache-Control": z <= 6 ? "public, max-age=86400" : "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Error generating MVT tile:", error);
    return Response.json(
      { error: "Failed to generate MVT tile" },
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});
