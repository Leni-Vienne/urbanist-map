import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'bun:test'
import { moderationRouter } from '../../routes/moderation'
import { TestHelpers } from '../utils/test-helpers'
import { getTestDb } from '../utils/test-database'
import { projects } from '../../db/schema'
import { eq } from 'drizzle-orm'

// AI : Mock TRPC context for admin user
const createMockAdminContext = () => ({
  user: {
    id: 'mock-admin-user',
    email: 'mock-admin@example.com',
    username: 'mock-admin',
    passwordHash: 'mock-hash',
    role: 'admin',
    emailVerified: true,
    emailVerificationToken: null,
    passwordResetToken: null,
    passwordResetExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  hono: {} as any,
})

describe('Moderation Routes - Version-Aware Approval Tests', () => {
  let testUser: any
  let testAdmin: any
  let testCity: any

  beforeAll(async () => {
    await TestHelpers.initialize()
  })

  afterAll(async () => {
    await TestHelpers.close()
  })

  beforeEach(async () => {
    await TestHelpers.cleanup()
    testUser = await TestHelpers.createTestUser({ role: 'user' })
    testAdmin = await TestHelpers.createTestUser({ role: 'admin' })
    testCity = await TestHelpers.getTestCity()
  })

  // AI : Remove duplicate cleanup

  describe('getPendingSubmissions with version info', () => {
    test('returns version field for projects', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id, 1, { status: 'pending' })
      
      const caller = moderationRouter.createCaller(createMockAdminContext())
      const result = await caller.getPendingSubmissions()
      
      expect(result.projects).toHaveLength(1)
      expect(result.projects[0].id).toBe(project.id)
      expect(result.projects[0].version).toBe(1)
    })

    test('returns version field for overlays', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id)
      const overlay = await TestHelpers.createTestOverlay(project.id, testUser.id, 1, { status: 'pending' })
      
      const caller = moderationRouter.createCaller(createMockAdminContext())
      const result = await caller.getPendingSubmissions()
      
      expect(result.projects[0].overlays).toHaveLength(1)
      expect(result.projects[0].overlays[0].version).toBe(1)
    })

    test('returns updated version after modifications', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id, 1, { status: 'pending' })
      
      // AI : Simulate user modifying project
      await TestHelpers.updateProject(project.id, { name: 'Modified Name' })
      
      const caller = moderationRouter.createCaller(createMockAdminContext())
      const result = await caller.getPendingSubmissions()
      
      expect(result.projects[0].version).toBe(2)
    })
  })

  describe('setProjectApprovalStatusWithVersion', () => {
    test('approves project with correct version', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id, 1, { status: 'pending' })
      
      const caller = moderationRouter.createCaller(createMockAdminContext())
      const result = await caller.setProjectApprovalStatusWithVersion({
        items: [{ id: project.id, expectedVersion: 1 }],
        status: 'approved'
      })
      
      expect(result.success).toBe(true)
      expect(result.conflicts).toHaveLength(0)
      
      // AI : Verify project is actually approved
      const currentVersion = await TestHelpers.getProjectVersion(project.id)
      expect(currentVersion).toBe(1) // Version shouldn't change on approval
    })

    test('rejects approval with stale version', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id, 1, { status: 'pending' })
      
      // AI : Simulate user modifying project (increments version to 2)
      await TestHelpers.updateProject(project.id, { name: 'Modified' })
      
      const caller = moderationRouter.createCaller(createMockAdminContext())
      const result = await caller.setProjectApprovalStatusWithVersion({
        items: [{ id: project.id, expectedVersion: 1 }], // Stale version
        status: 'approved'
      })
      
      expect(result.success).toBe(false)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0].error).toBe('Version mismatch')
      expect(result.conflicts[0].expectedVersion).toBe(1)
      expect(result.conflicts[0].currentVersion).toBe(2)
    })

    test('handles multiple projects with mixed version states', async () => {
      const project1 = await TestHelpers.createTestProject(testUser.id, testCity.id, 1, { status: 'pending', name: 'Project 1' })
      const project2 = await TestHelpers.createTestProject(testUser.id, testCity.id, 1, { status: 'pending', name: 'Project 2' })
      
      // AI : Modify only project2
      await TestHelpers.updateProject(project2.id, { name: 'Modified Project 2' })
      
      const caller = moderationRouter.createCaller(createMockAdminContext())
      const result = await caller.setProjectApprovalStatusWithVersion({
        items: [
          { id: project1.id, expectedVersion: 1 }, // Correct version
          { id: project2.id, expectedVersion: 1 }  // Stale version
        ],
        status: 'approved'
      })
      
      // AI : With atomic operations, project1 should succeed, project2 should fail
      expect(result.success).toBe(false) // Overall operation fails due to project2 conflict
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0].id).toBe(project2.id)
      expect(result.conflicts[0].error).toBe('Version mismatch')
      expect(result.successfulUpdates).toEqual([project1.id]) // project1 was successfully approved
      
      // AI : Check actual project states in database
      const db = getTestDb()
      const [finalProject1] = await db.select().from(projects).where(eq(projects.id, project1.id)).limit(1)
      const [finalProject2] = await db.select().from(projects).where(eq(projects.id, project2.id)).limit(1)
      
      expect(finalProject1.status).toBe('approved') // project1 succeeded
      expect(finalProject2.status).toBe('pending')  // project2 failed, still pending
      
      // AI : Check getPendingSubmissions - project1 shouldn't appear (approved), project2 should appear (pending)
      const submissionData = await moderationRouter.createCaller(createMockAdminContext()).getPendingSubmissions()
      const pendingProjects = submissionData.projects
      
      expect(pendingProjects.find(p => p.id === project1.id)).toBeUndefined() // Not in pending list anymore
      expect(pendingProjects.find(p => p.id === project2.id)?.status).toBe('pending') // Still pending
    })

    test('handles non-existent project', async () => {
      const caller = moderationRouter.createCaller(createMockAdminContext())
      const result = await caller.setProjectApprovalStatusWithVersion({
        items: [{ id: '00000000-0000-0000-0000-000000000000', expectedVersion: 1 }], // AI : Use valid UUID format
        status: 'approved'
      })
      
      expect(result.success).toBe(false)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0].error).toBe('Project not found')
    })

    test('successfully approves multiple projects with correct versions', async () => {
      const project1 = await TestHelpers.createTestProject(testUser.id, testCity.id, 1, { status: 'pending' })
      const project2 = await TestHelpers.createTestProject(testUser.id, testCity.id, 1, { status: 'pending' })
      
      const caller = moderationRouter.createCaller(createMockAdminContext())
      const result = await caller.setProjectApprovalStatusWithVersion({
        items: [
          { id: project1.id, expectedVersion: 1 },
          { id: project2.id, expectedVersion: 1 }
        ],
        status: 'approved'
      })
      
      expect(result.success).toBe(true)
      expect(result.conflicts).toHaveLength(0)
    })
  })

  describe('setOverlayApprovalStatusWithVersion', () => {
    test('approves overlay with correct version', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id)
      const overlay = await TestHelpers.createTestOverlay(project.id, testUser.id, 1, { status: 'pending' })
      
      const caller = moderationRouter.createCaller(createMockAdminContext())
      const result = await caller.setOverlayApprovalStatusWithVersion({
        items: [{ id: overlay.id, expectedVersion: 1 }],
        status: 'approved'
      })
      
      expect(result.success).toBe(true)
      expect(result.conflicts).toHaveLength(0)
    })

    test('rejects approval with stale version', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id)
      const overlay = await TestHelpers.createTestOverlay(project.id, testUser.id, 1, { status: 'pending' })
      
      // AI : Simulate user modifying overlay (increments version to 2)
      await TestHelpers.updateOverlay(overlay.id, { caption: 'Modified Caption' })
      
      const caller = moderationRouter.createCaller(createMockAdminContext())
      const result = await caller.setOverlayApprovalStatusWithVersion({
        items: [{ id: overlay.id, expectedVersion: 1 }], // Stale version
        status: 'approved'
      })
      
      expect(result.success).toBe(false)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0].error).toBe('Version mismatch')
      expect(result.conflicts[0].expectedVersion).toBe(1)
      expect(result.conflicts[0].currentVersion).toBe(2)
    })

    test('handles rejection with version validation', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id)
      const overlay = await TestHelpers.createTestOverlay(project.id, testUser.id, 1, { status: 'pending' })
      
      const caller = moderationRouter.createCaller(createMockAdminContext())
      const result = await caller.setOverlayApprovalStatusWithVersion({
        items: [{ id: overlay.id, expectedVersion: 1 }],
        status: 'rejected'
      })
      
      expect(result.success).toBe(true)
      expect(result.conflicts).toHaveLength(0)
    })

    test('handles non-existent overlay', async () => {
      const caller = moderationRouter.createCaller(createMockAdminContext())
      const result = await caller.setOverlayApprovalStatusWithVersion({
        items: [{ id: '00000000-0000-0000-0000-000000000000', expectedVersion: 1 }], // AI : Use valid UUID format
        status: 'approved'
      })
      
      expect(result.success).toBe(false)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0].error).toBe('Overlay not found')
    })
  })

  describe('Edge cases and error handling', () => {
    test('handles empty items array', async () => {
      const caller = moderationRouter.createCaller(createMockAdminContext())
      
      const projectResult = await caller.setProjectApprovalStatusWithVersion({
        items: [],
        status: 'approved'
      })
      
      const overlayResult = await caller.setOverlayApprovalStatusWithVersion({
        items: [],
        status: 'approved'  
      })
      
      expect(projectResult.success).toBe(true)
      expect(projectResult.conflicts).toHaveLength(0)
      expect(overlayResult.success).toBe(true)
      expect(overlayResult.conflicts).toHaveLength(0)
    })

    test('validates version is a number', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id, 5)
      
      const caller = moderationRouter.createCaller(createMockAdminContext())
      const result = await caller.setProjectApprovalStatusWithVersion({
        items: [{ id: project.id, expectedVersion: 5 }],
        status: 'approved'
      })
      
      expect(result.success).toBe(true)
      expect(typeof result.conflicts).toBe('object')
    })

    test('handles large version numbers', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id)
      
      // AI : Simulate a few updates to get higher version number - reduced from 100 to 5
      for (let i = 0; i < 5; i++) {
        await TestHelpers.updateProject(project.id, { name: `Update ${i}` })
      }
      
      const currentVersion = await TestHelpers.getProjectVersion(project.id)
      expect(currentVersion).toBe(6)
      
      const caller = moderationRouter.createCaller(createMockAdminContext())
      const result = await caller.setProjectApprovalStatusWithVersion({
        items: [{ id: project.id, expectedVersion: 6 }],
        status: 'approved'
      })
      
      expect(result.success).toBe(true)
    })
  })
})