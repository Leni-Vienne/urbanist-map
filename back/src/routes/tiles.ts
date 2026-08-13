import { Hono } from "hono";
import { tilesSqlClientLowZoom, tilesSqlClientHighZoom, db } from "../database";
import { sql } from "drizzle-orm";

// Tile cache tuning, shared by every tile variant.
//   low-zoom  (z0-z6): ~5.5k tiles total, pre-warmed at startup and effectively permanent.
//   high-zoom (z7-z10): an LRU bounded by both entry count (mostly relevant for empty-tile
//   entries, which hold no buffer) and total buffer bytes; cold tiles regenerate on demand.
const LOW_ZOOM_MAX = 6;
const HIGH_ZOOM_MAX = 10;
const LOW_ZOOM_CACHE_MAX = 8000; // > 5461 (count of all z0-z6 tiles), so nothing ever evicts
const HIGH_ZOOM_CACHE_MAX_ENTRIES = 12_000;
const HIGH_ZOOM_CACHE_MAX_BYTES = 256 * 1024 * 1024;

function entryBytes(val: Uint8Array | null): number {
  return val === null ? 0 : val.length;
}

function lngLatToTileXY(lng: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return [x, Math.max(0, Math.min(n - 1, y))];
}

// Minimum geometry_size_m to show a shape at a given zoom level.
// NULL means show all shapes (no size gate).
// Passed as $4 to the variant SQL so the planner can use partial GIST indexes.
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

// In Docker prod, routes/ is bind-mounted next to the bundle at /home/bun/app.
// In dev, resolve from the working directory (project root for every dev script), so the path
// holds whether the backend runs from source (`bun --hot back/src/index.ts`) or from the bundle
// (`bun ./server.bundle.js`), since bundling flattens import.meta.dir to the bundle's location.
function resolveSqlPath(fileName: string): string {
  return process.env.NODE_ENV !== "development"
    ? `/home/bun/app/routes/${fileName}`
    : `${process.cwd()}/back/src/routes/${fileName}`;
}

type TileService = {
  app: Hono;
  warm: () => Promise<void>;
  invalidateBbox: (minLng: number, minLat: number, maxLng: number, maxLat: number) => void;
  clearCache: () => void;
};

function getCachedTile(
  cache: Map<string, Uint8Array | null>,
  key: string,
): Uint8Array | null | undefined {
  const val = cache.get(key);
  if (val === undefined) return undefined;
  // Promote to end (most recently used)
  cache.delete(key);
  cache.set(key, val);
  return val;
}

// Builds one self-contained tile pipeline: isolated in-memory caches, an in-flight coalescer, the
// generation/serving logic, and a Hono app exposing it. Each variant points at its own SQL file so
// the two endpoints can diverge in both data and tuning without sharing cache state (the cache keys
// are bare `z/x/y`, so two variants must never share a Map or their tiles would collide).
function createTileService(
  routePath: string,
  sqlFileName: string,
  getParams: (z: number, x: number, y: number) => unknown[],
): TileService {
  const sqlPath = resolveSqlPath(sqlFileName);

  // Map insertion order = LRU order (oldest first). null = empty tile (204), Uint8Array = tile data.
  const lowZoomCache = new Map<string, Uint8Array | null>();
  const highZoomCache = new Map<string, Uint8Array | null>();

  // In-flight tile generations, keyed by `${z}/${x}/${y}`. Concurrent requests for the same uncached
  // tile share one promise so the expensive query runs once.
  const inFlightTiles = new Map<string, Promise<Uint8Array | null>>();

  // Summed bytes of highZoomCache entries (null entries count as 0).
  // Must be kept in sync by routing all writes/deletes through the helpers below.
  let highZoomCacheBytes = 0;

  function cacheForZoom(z: number): Map<string, Uint8Array | null> {
    return z <= LOW_ZOOM_MAX ? lowZoomCache : highZoomCache;
  }

  function deleteCachedTile(cache: Map<string, Uint8Array | null>, key: string) {
    const val = cache.get(key);
    if (val === undefined) return;
    if (cache === highZoomCache) highZoomCacheBytes -= entryBytes(val);
    cache.delete(key);
  }

  function clearCache() {
    lowZoomCache.clear();
    highZoomCache.clear();
    highZoomCacheBytes = 0;
  }

  // Evicts every cached tile intersecting the given WGS84 bbox at each cached zoom level
  // z0..HIGH_ZOOM_MAX. The range is expanded by one tile in every direction because features
  // within the 64-unit MVT buffer of a tile edge also render in the neighbouring tile.
  // A bbox spanning an implausibly large tile range falls back to a full cache clear.
  function invalidateBbox(minLng: number, minLat: number, maxLng: number, maxLat: number) {
    for (let z = 0; z <= HIGH_ZOOM_MAX; z += 1) {
      const n = 2 ** z;
      const [xA, yA] = lngLatToTileXY(minLng, minLat, z);
      const [xB, yB] = lngLatToTileXY(maxLng, maxLat, z);
      const xMin = Math.max(0, Math.min(xA, xB) - 1);
      const xMax = Math.min(n - 1, Math.max(xA, xB) + 1);
      const yMin = Math.max(0, Math.min(yA, yB) - 1);
      const yMax = Math.min(n - 1, Math.max(yA, yB) + 1);
      if ((xMax - xMin + 1) * (yMax - yMin + 1) > 256) {
        clearCache();
        return;
      }
      const cache = cacheForZoom(z);
      for (let x = xMin; x <= xMax; x += 1) {
        for (let y = yMin; y <= yMax; y += 1) {
          deleteCachedTile(cache, `${z}/${x}/${y}`);
        }
      }
    }
  }

  function setCachedTile(
    cache: Map<string, Uint8Array | null>,
    key: string,
    val: Uint8Array | null,
  ) {
    deleteCachedTile(cache, key);
    if (cache === highZoomCache) {
      // Evict oldest entries until both the entry-count and byte budgets fit the new entry.
      while (
        cache.size >= HIGH_ZOOM_CACHE_MAX_ENTRIES ||
        highZoomCacheBytes + entryBytes(val) > HIGH_ZOOM_CACHE_MAX_BYTES
      ) {
        const firstKey = cache.keys().next().value;
        if (firstKey === undefined) break;
        deleteCachedTile(cache, firstKey);
      }
      highZoomCacheBytes += entryBytes(val);
    } else if (cache.size >= LOW_ZOOM_CACHE_MAX) {
      const firstKey = cache.keys().next().value;
      if (firstKey !== undefined) cache.delete(firstKey);
    }
    cache.set(key, val);
  }

  // Runs the variant SQL against the zoom-appropriate pool. Returns the MVT bytes, or null for an
  // empty tile. The DB Buffer is copied once into a standalone Uint8Array: the Buffer may be a view
  // into a larger pooled ArrayBuffer, so copying both detaches it (the cache retains only the tile's
  // bytes) and yields a value that can be served directly on every subsequent cache hit.
  async function generateTile(z: number, x: number, y: number): Promise<Uint8Array | null> {
    const client = z <= LOW_ZOOM_MAX ? tilesSqlClientLowZoom : tilesSqlClientHighZoom;
    const [row] = await client.file(sqlPath, getParams(z, x, y));
    const rawTile = row?.tile;
    return Buffer.isBuffer(rawTile) && rawTile.length > 0 ? new Uint8Array(rawTile) : null;
  }

  // Coalesces concurrent generations of the same tile so a burst of identical requests runs the
  // expensive query once. The shared promise also performs the cache write, so the tile is stored
  // exactly once regardless of how many callers awaited it.
  async function generateTileCoalesced(
    z: number,
    x: number,
    y: number,
    cacheKey: string,
    cache: Map<string, Uint8Array | null>,
    useCache: boolean,
  ): Promise<Uint8Array | null> {
    const existing = inFlightTiles.get(cacheKey);
    if (existing !== undefined) return existing;

    const promise = (async () => {
      const data = await generateTile(z, x, y);
      if (useCache) setCachedTile(cache, cacheKey, data);
      return data;
    })().finally(() => inFlightTiles.delete(cacheKey));

    inFlightTiles.set(cacheKey, promise);
    return promise;
  }

  // Pre-generates every z0-z6 tile into the low-zoom cache so a continental zoom-out or pan is a
  // memory hit instead of a cold 1-2s query. The z0-z6 set is fixed (~5.5k tiles) and the data is
  // static OSM, so this is a one-time cost per process. Bounded concurrency on the low-zoom pool;
  // individual failures are logged and skipped.
  async function warm(): Promise<void> {
    const started = Date.now();
    const coords: [number, number, number][] = [];
    for (let z = 0; z <= LOW_ZOOM_MAX; z += 1) {
      const n = 2 ** z;
      for (let x = 0; x < n; x += 1) {
        for (let y = 0; y < n; y += 1) coords.push([z, x, y]);
      }
    }
    console.log(`Warming ${coords.length} low-zoom tiles (${sqlFileName})...`);

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
          console.error(`Tile cache warm failed for ${sqlFileName} ${z}/${x}/${y}:`, error);
        }
      }
    }

    const workers: Promise<void>[] = [];
    for (let i = 0; i < 3; i += 1) workers.push(worker());
    await Promise.all(workers);
    console.log(
      `Warmed ${warmed}/${coords.length} low-zoom tiles (${sqlFileName}) in ${Date.now() - started}ms`,
    );
  }

  const app = new Hono();

  // GET <routePath> -> serves MVT tiles with three layers (project-shapes, overlay-footprints,
  // project-points). See the variant SQL for the exact layer contents.
  app.get(routePath, async (c) => {
    try {
      const z = Number.parseInt(c.req.param("z") ?? "", 10);
      const x = Number.parseInt(c.req.param("x") ?? "", 10);
      const y = Number.parseInt(c.req.param("y") ?? "", 10);

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
      // SQL edits require a server restart to flush the cache (a plain --hot reload won't).
      const useCache = z <= HIGH_ZOOM_MAX;
      const cache = cacheForZoom(z);

      if (useCache) {
        const cached = getCachedTile(cache, cacheKey);
        if (cached !== undefined) {
          if (cached === null) return new Response(null, { status: 204 });
          return tileResponse(cached, z);
        }
      }

      // Coalesces concurrent misses for this tile and writes the cache exactly once.
      const tileData = await generateTileCoalesced(z, x, y, cacheKey, cache, useCache);

      if (tileData === null) {
        // Return empty 204 No Content for empty tiles (standard for MVT)
        return new Response(null, { status: 204 });
      }

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

  return { app, warm, invalidateBbox, clearCache };
}

function tileResponse(tileData: Uint8Array, z: number): Response {
  // In prod: low-zoom tiles (z0-z6) contain only OSM-imported data that changes at most
  // monthly, so cache them aggressively. High-zoom tiles may include freshly approved
  // overlays, so keep their TTL short.
  const cacheControl = z <= 6 ? "public, max-age=86400" : "public, max-age=3600";
  // generateTile builds each cached value via `new Uint8Array(buf)`, so the backing store is always a
  // plain ArrayBuffer; the assertion just narrows ArrayBufferLike for the BodyInit type.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return new Response(tileData as Uint8Array<ArrayBuffer>, {
    headers: {
      "Content-Type": "application/vnd.mapbox-vector-tile",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": cacheControl,
    },
  });
}

// The tile service mapping to tiles.sql and its dedicated caches.
const tileService = createTileService("/projects/:z/:x/:y", "tiles.sql", (z, x, y) => [
  z,
  x,
  y,
  shapesMinSizeM(z),
]);

export const tilesApp = tileService.app;

// Pre-warm the low-zoom cache at startup so a continental zoom-out is a memory hit.
export async function warmLowZoomTileCache(): Promise<void> {
  const started = Date.now();
  console.log("Starting low-zoom tile cache warm...");
  await tileService.warm();
  console.log(`Low-zoom tile cache warmed in ${Date.now() - started}ms`);
}

type BboxRow = { min_lng: number; min_lat: number; max_lng: number; max_lat: number };

// Invalidates the tile caches, since an approval/edit changes the underlying data. Falls back to a
// full clear when the bbox row is missing or any extent is not a number.

function invalidateAllFromBboxRow(row: Partial<BboxRow> | undefined) {
  if (
    row !== undefined &&
    typeof row.min_lng === "number" &&
    typeof row.min_lat === "number" &&
    typeof row.max_lng === "number" &&
    typeof row.max_lat === "number"
  ) {
    tileService.invalidateBbox(row.min_lng, row.min_lat, row.max_lng, row.max_lat);
  } else {
    tileService.clearCache();
  }
}

export async function invalidateProjectTiles(projectId: string) {
  try {
    const rows = await db.execute<Partial<BboxRow>>(sql`
      SELECT ST_XMin(g) AS min_lng, ST_YMin(g) AS min_lat,
             ST_XMax(g) AS max_lng, ST_YMax(g) AS max_lat
      FROM (
        SELECT COALESCE(geometry, center_coordinate) AS g
        FROM projects
        WHERE id = ${projectId}
      ) s
      WHERE g IS NOT NULL
    `);
    invalidateAllFromBboxRow(rows[0]);
  } catch {
    tileService.clearCache();
  }
}

export async function invalidateOverlayTiles(overlayId: string) {
  try {
    const rows = await db.execute<Partial<BboxRow>>(sql`
      SELECT ST_XMin(g) AS min_lng, ST_YMin(g) AS min_lat,
             ST_XMax(g) AS max_lng, ST_YMax(g) AS max_lat
      FROM (
        SELECT COALESCE(o.corners, p.center_coordinate) AS g
        FROM overlays o
        JOIN projects p ON p.id = o.project_id
        WHERE o.id = ${overlayId}
      ) s
      WHERE g IS NOT NULL
    `);
    invalidateAllFromBboxRow(rows[0]);
  } catch {
    tileService.clearCache();
  }
}
