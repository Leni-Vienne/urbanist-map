import { drizzle } from "drizzle-orm/bun-sql";
import { SQL } from "bun";
import { config } from "./config";
import * as schema from "./db/schema";

// AI : Connection pool configuration for production
// AI : postgres-js handles pooling automatically, but we configure limits
const client = new SQL(config.DATABASE_URL, {
  // AI : Maximum number of connections in pool (default: 10)
  // AI : For VPS with 2-4 CPU cores, 10-20 is optimal
  // AI : Formula: (CPU cores * 2) + effective_spindle_count
  max: 20,

  // AI : Close idle connections after 30 seconds to free resources
  idle_timeout: 30,

  // AI : Maximum time to wait for connection before erroring (30 seconds)
  connect_timeout: 30,

  // AI : Use prepared statements for better performance (cache query plans)
  prepare: true,
});

export const db = drizzle({ client, schema });
export type Database = typeof db;
