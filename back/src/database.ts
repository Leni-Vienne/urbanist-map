import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { config } from './config'
import * as schema from './db/schema'

// AI : Global database instance for the application
const client = postgres(config.DATABASE_URL, {
    ssl: config.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 10,
    fetch_types: false,
})

export const db = drizzle(client, { schema })
export type Database = typeof db