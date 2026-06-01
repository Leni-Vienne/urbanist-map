import { drizzle } from "drizzle-orm/bun-sql";
import { SQL } from "bun";
import { config } from "./config";
import * as schema from "./db/schema";

const isDev = process.env.NODE_ENV !== "production";

// Connection pool configuration
// In dev, keep the pool small: hot reloads create new pool instances while old
// connections linger on the PostgreSQL side until TCP keepalive expires,
// so a large dev pool quickly exhausts max_connections after a few reloads.
const mainDbUrl = new URL(config.DATABASE_URL);
mainDbUrl.searchParams.set("options", "-c statement_timeout=15000");

const client = new SQL(mainDbUrl.toString(), {
  max: isDev ? 3 : 20,
  idle_timeout: isDev ? 0 : 300,
  connect_timeout: 30,
  prepare: true,
});

export const db = drizzle({ client, schema });
export type Database = typeof db;

// MVT tile generation uses two zoom-tuned pools because the two workloads have opposite needs.
// Both share these session settings:
//   jit=off            -- The tile query's estimated cost exceeds jit_above_cost (due to PostGIS
//                         function costs), but actual row count is small, so LLVM compilation time
//                         (~36ms) far outweighs any per-row savings.
//   statement_timeout  -- Caps any single tile query at 30s so a stuck or pathologically slow
//                         query (e.g. a freshly bloated dense low-zoom tile after an OSM import)
//                         throws instead of pinning a pool connection. The handler catches the
//                         resulting PG cancel error and returns a 500 with CORS headers, which
//                         the browser surfaces as a real failure instead of a connection drop.
//
// Low-zoom pool (z<=6): a single dense z2 tile sorts ~144MB of point rows, so it needs a large
// work_mem to stay in memory. These tiles are few (~5.5k total for z0-z6) and fully cached/pre-warmed,
// so they run rarely at runtime; a small connection count is enough and keeps the memory ceiling bounded.
function buildTilesUrl(workMem: string): string {
  const url = new URL(config.DATABASE_URL);
  url.searchParams.set("options", `-c jit=off -c work_mem=${workMem} -c statement_timeout=30000`);
  return url.toString();
}

export const tilesSqlClientLowZoom = new SQL(buildTilesUrl("256MB"), {
  max: isDev ? 1 : 3,
  // Keep idle connections warm (never reap in dev, 5 min in prod), matching the main pool.
  // An aggressive idle_timeout reaps the few pooled connections during quiet periods, and
  // bun-sql can reject a query that lands on a connection mid-reap with "Idle timeout reached".
  idle_timeout: isDev ? 0 : 300,
  connect_timeout: 30,
});

// High-zoom pool (z>=7): each tile sorts only a few MB, but a single map pan fires ~15-20 tile
// requests at once. A high connection count clears that burst without queueing, and the modest
// per-connection work_mem keeps the ceiling low despite the larger pool.
export const tilesSqlClientHighZoom = new SQL(buildTilesUrl("32MB"), {
  max: isDev ? 2 : 16,
  idle_timeout: isDev ? 0 : 300,
  connect_timeout: 30,
});
