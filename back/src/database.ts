import { drizzle } from "drizzle-orm/bun-sql";
import { SQL } from "bun";
import { config } from "./config";
import * as schema from "./db/schema";

const isDev = process.env.NODE_ENV !== "production";

// Connection pool configuration
// In dev, keep the pool small: hot reloads create new pool instances while old
// connections linger on the PostgreSQL side until TCP keepalive expires,
// so a large dev pool quickly exhausts max_connections after a few reloads.
const client = new SQL(config.DATABASE_URL, {
  max: isDev ? 3 : 20,
  idle_timeout: isDev ? 0 : 300,
  connect_timeout: 30,
  prepare: true,
});

export const db = drizzle({ client, schema });
export type Database = typeof db;

// Dedicated pool for MVT tile generation with tuned session settings:
//   jit=off            -- The tile query's estimated cost exceeds jit_above_cost (due to PostGIS
//                         function costs), but actual row count is small, so LLVM compilation time
//                         (~36ms) far outweighs any per-row savings.
//   work_mem=128MB     -- Low-zoom tiles (z0-z6) process 100k+ point rows in a single sort.
//                         With the default 4MB, the sort spills 60+ MB to disk, adding ~600ms.
//                         128MB keeps the sort in memory. With max 4 tile connections the ceiling
//                         is 512MB, well within typical server capacity.
//   statement_timeout  -- Caps any single tile query at 30s so a stuck or pathologically slow
//                         query (e.g. a freshly bloated dense low-zoom tile after an OSM import)
//                         throws instead of pinning a pool connection. The handler catches the
//                         resulting PG cancel error and returns a 500 with CORS headers, which
//                         the browser surfaces as a real failure instead of a connection drop.
const tilesDbUrl = new URL(config.DATABASE_URL);
tilesDbUrl.searchParams.set("options", "-c jit=off -c work_mem=128MB -c statement_timeout=30000");

export const tilesSqlClient = new SQL(tilesDbUrl.toString(), {
  max: isDev ? 1 : 4,
  idle_timeout: 30,
  connect_timeout: 30,
});
