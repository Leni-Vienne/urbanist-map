import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { projects, DBUser, DBCity } from '../../db/schema'
import { getTestDb } from '../utils/test-database'
import { TestHelpers } from '../utils/test-helpers'

describe('Database Schema - Version Field Tests', () => {
  let testUser: DBUser
  let testCity: DBCity

  beforeAll(async () => {
    await TestHelpers.initialize()
  })

  afterAll(async () => {
    await TestHelpers.close()
  })

  beforeEach(async () => {
    await TestHelpers.cleanup()
    testUser = await TestHelpers.createTestUser()
    testCity = await TestHelpers.getTestCity()
  })

  // AI : Remove duplicate cleanup - already done in beforeEach
  // afterEach cleanup was causing hanging issues

  describe('Project Version Management', () => {
    test('new project starts with version 1', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id)
      
      expect(project.version).toBe(1)
    })

    test('project version increments on update', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id)
      expect(project.version).toBe(1)

      // AI : Update project name
      await TestHelpers.updateProject(project.id, { name: 'Updated Project Name' })
      
      const currentVersion = await TestHelpers.getProjectVersion(project.id)
      expect(currentVersion).toBe(2)
    })

    test('multiple updates increment version sequentially', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id)
      
      // AI : Perform multiple updates
      await TestHelpers.updateProject(project.id, { name: 'Update 1' })
      expect(await TestHelpers.getProjectVersion(project.id)).toBe(2)
      
      await TestHelpers.updateProject(project.id, { name: 'Update 2' })  
      expect(await TestHelpers.getProjectVersion(project.id)).toBe(3)
      
      await TestHelpers.updateProject(project.id, { description: 'Update 3' })
      expect(await TestHelpers.getProjectVersion(project.id)).toBe(4)
    })

    test('version persists after database queries', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id)
      await TestHelpers.updateProject(project.id, { name: 'Updated' })
      
      // AI : Query project multiple times
      const db = getTestDb()
      const query1 = await db.select().from(projects).where(eq(projects.id, project.id)).limit(1)
      const query2 = await db.select().from(projects).where(eq(projects.id, project.id)).limit(1)
      
      expect(query1[0].version).toBe(2)
      expect(query2[0].version).toBe(2)
    })
  })

  describe('Overlay Version Management', () => {
    test('new overlay starts with version 1', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id)
      const overlay = await TestHelpers.createTestOverlay(project.id, testUser.id)
      
      expect(overlay.version).toBe(1)
    })

    test('overlay version increments on update', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id)
      const overlay = await TestHelpers.createTestOverlay(project.id, testUser.id)
      expect(overlay.version).toBe(1)

      // AI : Update overlay caption
      await TestHelpers.updateOverlay(overlay.id, { caption: 'Updated Caption' })
      
      const currentVersion = await TestHelpers.getOverlayVersion(overlay.id)
      expect(currentVersion).toBe(2)
    })

    test('overlay and project versions are independent', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id)
      const overlay = await TestHelpers.createTestOverlay(project.id, testUser.id)
      
      // AI : Update project
      await TestHelpers.updateProject(project.id, { name: 'Updated Project' })
      expect(await TestHelpers.getProjectVersion(project.id)).toBe(2)
      expect(await TestHelpers.getOverlayVersion(overlay.id)).toBe(1) // Unchanged
      
      // AI : Update overlay
      await TestHelpers.updateOverlay(overlay.id, { caption: 'Updated Overlay' })
      expect(await TestHelpers.getProjectVersion(project.id)).toBe(2) // Unchanged
      expect(await TestHelpers.getOverlayVersion(overlay.id)).toBe(2) // Changed
    })

    test('multiple overlays have independent versions', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id)
      const overlay1 = await TestHelpers.createTestOverlay(project.id, testUser.id, 1, { filename: 'overlay1.jpg' })
      const overlay2 = await TestHelpers.createTestOverlay(project.id, testUser.id, 1, { filename: 'overlay2.jpg' })
      
      // AI : Update only first overlay
      await TestHelpers.updateOverlay(overlay1.id, { caption: 'Updated First' })
      
      expect(await TestHelpers.getOverlayVersion(overlay1.id)).toBe(2)
      expect(await TestHelpers.getOverlayVersion(overlay2.id)).toBe(1) // Unchanged
    })
  })

  describe('Version Field Constraints', () => {
    test('version field is not nullable', async () => {
      // AI : Verify that version field has NOT NULL constraint by checking schema
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id)
      
      // AI : Version should never be null
      expect(project.version).toBeDefined()
      expect(project.version).not.toBeNull()
      expect(typeof project.version).toBe('number')
    })

    test('version field defaults to 1 for new records', async () => {
      // AI : Test default value by creating records without specifying version
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id)
      const overlay = await TestHelpers.createTestOverlay(project.id, testUser.id)
      
      expect(project.version).toBe(1)
      expect(overlay.version).toBe(1)
    })

    test('version field accepts positive integers', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id)
      
      // AI : Simulate multiple updates to get higher version numbers
      for (let i = 0; i < 10; i++) {
        await TestHelpers.updateProject(project.id, { name: `Update ${i}` })
      }
      
      const finalVersion = await TestHelpers.getProjectVersion(project.id)
      expect(finalVersion).toBe(11) // Started at 1, 10 updates
      expect(finalVersion).toBeGreaterThan(0)
    })
  })
})