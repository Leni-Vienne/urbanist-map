import { Hono } from "hono";
import { tilesSqlClientLowZoom, tilesSqlClientHighZoom, db } from "../database";
import { projects, overlays } from "../db/schema";
import { eq } from "drizzle-orm";

export const tilesApp = new Hono();

// In-memory tile caches. null = empty tile (204), Buffer = tile data.
// Two caches so high-zoom LRU churn never evicts the bounded, pre-warmed low-zoom set.
//   low-zoom  (z0-z6): ~5.5k tiles total, pre-warmed at startup and effectively permanent.
//   high-zoom (z7-z10): an LRU sized for active panning; cold tiles regenerate on demand.
const LOW_ZOOM_MAX = 6;
const HIGH_ZOOM_MAX = 10;
const LOW_ZOOM_CACHE_MAX = 8000; // > 5461 (count of all z0-z6 tiles), so nothing ever evicts
const HIGH_ZOOM_CACHE_MAX = 12_000;

// Map insertion order = LRU order (oldest first)
const lowZoomCache = new Map<string, Buffer | null>();
const highZoomCache = new Map<string, Buffer | null>();

function cacheForZoom(z: number): Map<string, Buffer | null> {
  return z <= LOW_ZOOM_MAX ? lowZoomCache : highZoomCache;
}

function maxForCache(cache: Map<string, Buffer | null>): number {
  return cache === lowZoomCache ? LOW_ZOOM_CACHE_MAX : HIGH_ZOOM_CACHE_MAX;
}

function clearTileCache() {
  lowZoomCache.clear();
  highZoomCache.clear();
}

function lngLatToTileXY(lng: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return [x, Math.max(0, Math.min(n - 1, y))];
}

// Evicts the single tile at each cached zoom level z0..HIGH_ZOOM_MAX that contains the given point.
// A point maps to exactly one tile per zoom, so this stays precise and cheap across both caches.
function invalidateTilesForPoint(lat: number, lng: number) {
  for (let z = 0; z <= HIGH_ZOOM_MAX; z += 1) {
    const [x, y] = lngLatToTileXY(lng, lat, z);
    cacheForZoom(z).delete(`${z}/${x}/${y}`);
  }
}

function getCachedTile(cache: Map<string, Buffer | null>, key: string): Buffer | null | undefined {
  const val = cache.get(key);
  if (val === undefined) return undefined;
  // Promote to end (most recently used)
  cache.delete(key);
  cache.set(key, val);
  return val;
}

function setCachedTile(cache: Map<string, Buffer | null>, key: string, val: Buffer | null) {
  if (cache.size >= maxForCache(cache)) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, val);
}

export async function invalidateProjectTiles(projectId: string) {
  try {
    const [row] = await db
      .select({ lat: projects.lat, lng: projects.lng })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (row !== undefined && row.lat !== null && row.lng !== null) {
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
    if (row !== undefined && row.lat !== null && row.lng !== null) {
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

// In Docker prod, routes/ is bind-mounted next to the bundle at /home/bun/app.
// In dev, import.meta.dir points to the source directory where tiles.sql lives.
const sqlPath =
  process.env.NODE_ENV !== "development"
    ? "/home/bun/app/routes/tiles.sql"
    : `${import.meta.dir}/tiles.sql`;

// Runs tiles.sql against the zoom-appropriate pool. Returns the MVT Buffer, or null for an empty tile.
async function generateTile(z: number, x: number, y: number): Promise<Buffer | null> {
  const client = z <= LOW_ZOOM_MAX ? tilesSqlClientLowZoom : tilesSqlClientHighZoom;
  const [row] = await client.file(sqlPath, [z, x, y, shapesMinSizeM(z), markerSuppressMinSizeM(z)]);
  const rawTile = row?.tile;
  return Buffer.isBuffer(rawTile) && rawTile.length > 0 ? rawTile : null;
}

function tileResponse(tileData: Buffer, z: number): Response {
  // In dev, never cache so tile-query changes are picked up on the next request (and on mobile).
  // In prod: low-zoom tiles (z0-z6) contain only OSM-imported data that changes at most
  // monthly, so cache them aggressively. High-zoom tiles may include freshly approved
  // overlays, so keep their TTL short.
  const cacheControl =
    process.env.NODE_ENV === "development"
      ? "no-store"
      : z <= 6
        ? "public, max-age=86400"
        : "public, max-age=3600";
  return new Response(new Uint8Array(tileData), {
    headers: {
      "Content-Type": "application/vnd.mapbox-vector-tile",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": cacheControl,
    },
  });
}

// Pre-generates every z0-z6 tile into the low-zoom cache so a continental zoom-out or pan is a
// memory hit instead of a cold 1-2s query. The z0-z6 set is fixed (~5.5k tiles) and the data is
// static OSM, so this is a one-time cost per process. Bounded concurrency on the low-zoom pool;
// individual failures are logged and skipped.
export async function warmLowZoomTileCache(): Promise<void> {
  const started = Date.now();
  const coords: [number, number, number][] = [];
  for (let z = 0; z <= LOW_ZOOM_MAX; z += 1) {
    const n = 2 ** z;
    for (let x = 0; x < n; x += 1) {
      for (let y = 0; y < n; y += 1) coords.push([z, x, y]);
    }
  }

  let next = 0;
  let warmed = 0;
  async function worker(): Promise<void> {
    while (next < coords.length) {
      const coord = coords[next];
      next += 1;
      if (coord === undefined) continue;
      const [z, x, y] = coord;
      try {
        const tile = await generateTile(z, x, y);
        setCachedTile(lowZoomCache, `${z}/${x}/${y}`, tile);
        warmed += 1;
      } catch (error) {
        console.error(`Tile cache warm failed for ${z}/${x}/${y}:`, error);
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < 3; i += 1) workers.push(worker());
  await Promise.all(workers);
  console.log(`Warmed ${warmed}/${coords.length} low-zoom tiles in ${Date.now() - started}ms`);
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
    const useCache = z <= HIGH_ZOOM_MAX;
    const cache = cacheForZoom(z);

    if (useCache) {
      const cached = getCachedTile(cache, cacheKey);
      if (cached !== undefined) {
        if (cached === null) return new Response(null, { status: 204 });
        return tileResponse(cached, z);
      }
    }

    const tileData = await generateTile(z, x, y);

    if (tileData === null) {
      // Return empty 204 No Content for empty tiles (standard for MVT)
      if (useCache) setCachedTile(cache, cacheKey, null);
      return new Response(null, { status: 204 });
    }

    if (useCache) setCachedTile(cache, cacheKey, tileData);

    return tileResponse(tileData, z);
  } catch (error) {
    // SQLSTATE 57014 = query_canceled, raised by Postgres when statement_timeout fires.
    const isTimeout =
      typeof error === "object" && error !== null && "code" in error && error.code === "57014";
    if (isTimeout) {
      console.error(
        `MVT tile statement_timeout hit for ${c.req.param("z")}/${c.req.param("x")}/${c.req.param("y")}`,
      );
    } else {
      console.error("Error generating MVT tile:", error);
    }
    return Response.json(
      { error: "Failed to generate MVT tile" },
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});
