import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../../db/schema'

// AI : Test database setup with proper initialization control
let testDb: ReturnType<typeof drizzle<typeof schema>> | null = null
let testClient: ReturnType<typeof postgres> | null = null

export function initTestDatabase() {
  if (testDb) {
    return testDb
  }

  // AI : Use test database URL from environment
  const testDatabaseUrl = process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/test'
  testClient = postgres(testDatabaseUrl, {
    max: 1, // AI : Single connection for tests to avoid conflicts
    idle_timeout: 30, // AI : Give more time for cleanup operations  
    connect_timeout: 15, // AI : Allow more time for initial connection
    max_lifetime: 120, // AI : Longer connection lifetime
    prepare: false, // AI : Disable prepared statements to avoid issues
    transform: undefined, // AI : Disable transforms that might cause delays
  })
  
  testDb = drizzle(testClient, { schema })
  return testDb
}

export function getTestDb() {
  if (!testDb) {
    throw new Error('Test database not initialized. Call initTestDatabase() first.')
  }
  return testDb
}

export async function closeTestDatabase() {
  if (testClient) {
    try {
      await Promise.race([
        testClient.end(),
        new Promise((_, reject) => 
          setTimeout(() => {
            reject(new Error('Database close timeout'))
          }, 5000)
        )
      ])
    } catch (error) {
      console.warn('⚠️ Database close failed:', error)
    } finally {
      testClient = null
      testDb = null
    }
  }
}

// AI : Export a getter function instead of direct export to avoid initialization issues
export const db = new Proxy({} as any, {
  get(target, prop) {
    return getTestDb()[prop as keyof typeof testDb]
  }
})