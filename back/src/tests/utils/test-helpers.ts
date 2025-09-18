import { eq, sql } from 'drizzle-orm'
import { projects, overlays, users, cities } from '../../db/schema'
import { initTestDatabase, getTestDb, closeTestDatabase } from './test-database'
import type { DBProject, DBOverlay, DBUser, DBCity } from '../../db/schema'
import type { Context } from 'hono'

// AI : Test utilities for version-based optimistic locking tests
export class TestHelpers {
  
  // AI : Initialize test database
  static async initialize() {
    initTestDatabase()
  }

  // AI : Close test database
  static async close() {
    await closeTestDatabase()
  }
  
  // AI : Fast cleanup using DELETE - DON'T touch cities (they're static data)
  static async cleanup() {
    try {
      const db = getTestDb()
      // AI : Delete only test data, NOT cities (they're static/imported data)
      await db.execute(sql`DELETE FROM overlays`)
      await db.execute(sql`DELETE FROM projects`) 
      await db.execute(sql`DELETE FROM users`)
    } catch (error) {
      console.warn('⚠️ Cleanup failed, continuing...', error)
    }
  }

  // AI : Create a test user with guaranteed unique data
  static async createTestUser(overrides: Partial<Pick<DBUser, 'email' | 'username' | 'role'>> = {}): Promise<DBUser> {
    const db = getTestDb()
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(7)
    const userData = {
      email: overrides.email ?? `test-${timestamp}-${random}@example.com`,
      username: overrides.username ?? `user-${timestamp}-${random}`,
      passwordHash: 'test-hash',
      role: overrides.role ?? 'user',
      emailVerified: true,
    }

    const [user] = await db.insert(users).values(userData).returning()
    return user
  }

  // AI : Get an existing city from the database - DON'T create cities in tests
  static async getTestCity(): Promise<DBCity> {
    const db = getTestDb()
    // AI : Get any existing city from the database
    const [city] = await db.select().from(cities).limit(1)
    if (!city) {
      throw new Error('No cities found in database. Make sure to run city import first.')
    }
    return city
  }

  // AI : Create a test project with guaranteed unique data
  static async createTestProject(
    ownerId: string, 
    cityId: string | null = null,
    version: number = 1,
    overrides: Partial<Pick<DBProject, 'name' | 'description' | 'status'>> = {}
  ): Promise<DBProject> {
    const db = getTestDb()
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(7)
    const projectData = {
      name: overrides.name ?? `Project-${timestamp}-${random}`,
      description: overrides.description ?? `Description-${timestamp}-${random}`,
      status: overrides.status ?? 'pending' as const,
      ownerId,
      cityId,
      version,
    }

    const [project] = await db.insert(projects).values(projectData).returning()
    return project
  }

  // AI : Create a test overlay with guaranteed unique data
  static async createTestOverlay(
    projectId: string,
    authorId: string,
    version: number = 1,
    overrides: Partial<Pick<DBOverlay, 'filename' | 'caption' | 'status'>> = {}
  ): Promise<DBOverlay> {
    const db = getTestDb()
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(7)
    const overlayData = {
      filename: overrides.filename ?? `overlay-${timestamp}-${random}.jpg`,
      caption: overrides.caption ?? `Caption-${timestamp}-${random}`,
      status: overrides.status ?? 'pending' as const,
      projectId,
      authorId,
      version,
      // AI : Default corner coordinates (rough rectangle over Paris)
      topLeftLat: 48.8606,
      topLeftLng: 2.3376,
      topRightLat: 48.8606,
      topRightLng: 2.3668,
      bottomRightLat: 48.8526,
      bottomRightLng: 2.3668,
      bottomLeftLat: 48.8526,
      bottomLeftLng: 2.3376,
      centroid: sql`ST_SetSRID(ST_MakePoint(2.3522, 48.8566), 4326)`,
    }

    const [overlay] = await db.insert(overlays).values(overlayData).returning()
    return overlay
  }

  // AI : Update project and verify version increment
  static async updateProject(projectId: string, updates: Partial<Pick<DBProject, 'name' | 'description'>>) {
    const db = getTestDb()
    await db.update(projects)
      .set({
        ...updates,
        version: sql`${projects.version} + 1`,
        updatedAt: new Date()
      })
      .where(eq(projects.id, projectId))
  }

  // AI : Update overlay and verify version increment  
  static async updateOverlay(overlayId: string, updates: Partial<Pick<DBOverlay, 'caption'>>) {
    const db = getTestDb()
    await db.update(overlays)
      .set({
        ...updates,
        version: sql`${overlays.version} + 1`, 
        updatedAt: new Date()
      })
      .where(eq(overlays.id, overlayId))
  }

  // AI : Get current version of project
  static async getProjectVersion(projectId: string): Promise<number> {
    const db = getTestDb()
    const [project] = await db
      .select({ version: projects.version })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
    
    return project?.version ?? 0
  }

  // AI : Get current version of overlay
  static async getOverlayVersion(overlayId: string): Promise<number> {
    const db = getTestDb()
    const [overlay] = await db
      .select({ version: overlays.version })
      .from(overlays)  
      .where(eq(overlays.id, overlayId))
      .limit(1)
    
    return overlay?.version ?? 0
  }

  // AI : Simulate version conflict by incrementing version manually
  static async simulateVersionConflict(entityId: string, entityType: 'project' | 'overlay') {
    const db = getTestDb()
    const table = entityType === 'project' ? projects : overlays
    await db.update(table)
      .set({ 
        version: sql`${table.version} + 1`,
        updatedAt: new Date() 
      })
      .where(eq(table.id as any, entityId))
  }

  // AI : Wait for specified milliseconds (for race condition testing)
  static async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // AI : Create mock user context for tRPC testing
  static createUserContext(userId: string) {
    return {
      user: {
        id: userId,
        email: `user-${userId}@example.com`,
        username: `user-${userId}`,
        passwordHash: 'mock-hash',
        role: 'user' as const,
        emailVerified: true,
        emailVerificationToken: null,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      hono: {} as Context,
    }
  }

  // AI : Create mock admin context for tRPC testing
  static createAdminContext(adminId: string) {
    return {
      user: {
        id: adminId,
        email: `admin-${adminId}@example.com`,
        username: `admin-${adminId}`,
        passwordHash: 'mock-hash',
        role: 'admin' as const,
        emailVerified: true,
        emailVerificationToken: null,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      hono: {} as Context,
    }
  }
}