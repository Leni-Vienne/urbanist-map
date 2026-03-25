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
  idle_timeout: 30,
  connect_timeout: 30,
  prepare: true,
});

export const db = drizzle({ client, schema });
export type Database = typeof db;

// Dedicated pool for MVT tile generation with JIT disabled.
// The tile query's estimated cost exceeds jit_above_cost (due to PostGIS function costs),
// but the actual row count processed is small (~7k projects), so LLVM compilation time
// (~36ms) far outweighs any per-row savings. Setting jit=off at connection startup
// eliminates this overhead with no per-query round-trip.
const tilesDbUrl = new URL(config.DATABASE_URL);
tilesDbUrl.searchParams.set("options", "-c jit=off");

export const tilesSqlClient = new SQL(tilesDbUrl.toString(), {
  max: isDev ? 1 : 4,
  idle_timeout: 30,
  connect_timeout: 30,
});
