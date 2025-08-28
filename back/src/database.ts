import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { config } from './config'
import * as schema from './db/schema'

// AI : Simple postgres client for long-running Bun server
const client = postgres(config.DATABASE_URL)

export const db = drizzle(client, { schema })
export type Database = typeof db