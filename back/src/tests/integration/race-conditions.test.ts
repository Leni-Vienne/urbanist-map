import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { projects, overlays } from '../../db/schema'
import { getTestDb } from '../utils/test-database'
import { moderationRouter } from '../../routes/moderation'
import { projectRouter } from '../../routes/project'
import { overlayRouter } from '../../routes/overlay'
import { TestHelpers } from '../utils/test-helpers'

// AI : Mock contexts for different user types
const createUserContext = (userId: string) => ({
  user: {
    id: userId,
    email: 'admin@example.com',
    username: 'admin',
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

const createAdminContext = (adminId: string) => ({
  user: {
    id: adminId,
    email: 'normal@example.com',
    username: 'normal',
    passwordHash: 'mock-hash',
    role: 'user',
    emailVerified: true,
    emailVerificationToken: null,
    passwordResetToken: null,
    passwordResetExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  hono: {} as any,
})

describe('Race Condition Prevention Tests', () => {
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
    testAdmin = await TestHelpers.createTestUser({ role: 'admin', email: 'admin@example.com' })
    testCity = await TestHelpers.getTestCity()
  })

  // AI : Remove duplicate cleanup - already done in beforeEach  
  // afterEach cleanup was causing hanging issues

  describe('Project Race Conditions', () => {
    test('prevents approval when user modifies project simultaneously', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id, 1, { status: 'pending' })
      
      const userCaller = projectRouter.createCaller(createUserContext(testUser.id))
      const adminCaller = moderationRouter.createCaller(createAdminContext(testAdmin.id))
      
      // AI : Simulate concurrent operations: user edits while moderator approves
      const [userEdit, moderatorApproval] = await Promise.allSettled([
        userCaller.publishProject({
          id: project.id,
          name: 'User Modified Name',
          description: project.description ?? undefined,
          cityId: testCity.id,
        }),
        adminCaller.setProjectApprovalStatusWithVersion({
          items: [{ id: project.id, expectedVersion: 1 }],
          status: 'approved'
        })
      ])
      
      // AI : User edit should succeed
      expect(userEdit.status).toBe('fulfilled')
      
      // AI : Moderator approval should either succeed (if it happened first) or fail (if user edit happened first)
      if (moderatorApproval.status === 'fulfilled') {
        const approval = (moderatorApproval as any).value
        if (!approval.success) {
          // AI : Version conflict detected - this is the expected behavior
          expect(approval.conflicts).toHaveLength(1)
          expect(approval.conflicts[0].error).toBe('Version mismatch')
        }
      }
      
      // AI : Verify final state is consistent
      const db = getTestDb()
      const [finalProject] = await db.select().from(projects).where(eq(projects.id, project.id)).limit(1)
      expect(finalProject).toBeDefined()
      
      // AI : Either project is approved (moderator won) or pending with updated name (user won)
      if (finalProject.status === 'approved') {
        // AI : Moderator approval happened first
        expect(finalProject.version).toBe(1)
      } else {
        // AI : User edit happened first, creating version conflict
        expect(finalProject.status).toBe('pending')
        expect(finalProject.name).toBe('User Modified Name')
        expect(finalProject.version).toBe(2)
      }
    })

    test('multiple concurrent user edits maintain version consistency', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id, 1, { status: 'pending' })
      
      const userCaller = projectRouter.createCaller(createUserContext(testUser.id))
      
      // AI : Simulate multiple concurrent edits from same user
      const editPromises = Array(5).fill(null).map((_, index) =>
        userCaller.publishProject({
          id: project.id,
          name: `Concurrent Edit ${index}`,
          description: project.description ?? undefined,
          cityId: testCity.id,
        })
      )
      
      const results = await Promise.allSettled(editPromises)
      
      // AI : All edits should succeed
      results.forEach(result => {
        expect(result.status).toBe('fulfilled')
      })
      
      // AI : Final version should reflect all edits
      const finalVersion = await TestHelpers.getProjectVersion(project.id)
      expect(finalVersion).toBe(6) // Started at 1, 5 edits = version 6
      
      // AI : Project should have one of the edit names
      const db = getTestDb()
      const [finalProject] = await db.select().from(projects).where(eq(projects.id, project.id)).limit(1)
      expect(finalProject.name).toMatch(/^Concurrent Edit \d+$/)
    })

    test('rapid approval attempts only succeed once', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id, 1, { status: 'pending' })
      
      const adminCaller = moderationRouter.createCaller(createAdminContext(testAdmin.id))
      
      // AI : Simulate multiple rapid approval attempts
      const approvalPromises = Array(10).fill(null).map(() =>
        adminCaller.setProjectApprovalStatusWithVersion({
          items: [{ id: project.id, expectedVersion: 1 }],
          status: 'approved'
        })
      )
      
      const results = await Promise.allSettled(approvalPromises)
      const successfulApprovals = results.filter(
        result => result.status === 'fulfilled' && (result as any).value.success
      )
      
      // AI : Only one approval should succeed
      expect(successfulApprovals).toHaveLength(1)
      
      // AI : Project should be approved
      const db = getTestDb()
      const [finalProject] = await db.select().from(projects).where(eq(projects.id, project.id)).limit(1)
      expect(finalProject.status).toBe('approved')
      expect(finalProject.version).toBe(1) // Version unchanged by approval
    })
  })

  describe('Overlay Race Conditions', () => {
    test('prevents approval when user modifies overlay simultaneously', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id)
      const overlay = await TestHelpers.createTestOverlay(project.id, testUser.id, 1, { status: 'pending' })
      
      const userCaller = overlayRouter.createCaller(createUserContext(testUser.id))
      const adminCaller = moderationRouter.createCaller(createAdminContext(testAdmin.id))
      
      // AI : Simulate concurrent operations
      const [userEdit, moderatorApproval] = await Promise.allSettled([
        userCaller.updateOverlay({
          id: overlay.id,
          caption: 'User Modified Caption'
        }),
        adminCaller.setOverlayApprovalStatusWithVersion({
          items: [{ id: overlay.id, expectedVersion: 1 }],
          status: 'approved'
        })
      ])
      
      // AI : User edit should succeed
      expect(userEdit.status).toBe('fulfilled')
      
      // AI : Check moderator approval result
      if (moderatorApproval.status === 'fulfilled') {
        const approval = (moderatorApproval as any).value
        if (!approval.success) {
          // AI : Version conflict detected
          expect(approval.conflicts).toHaveLength(1)
          expect(approval.conflicts[0].error).toBe('Version mismatch')
        }
      }
      
      // AI : Verify final state
      const db = getTestDb()
      const [finalOverlay] = await db.select().from(overlays).where(eq(overlays.id, overlay.id)).limit(1)
      expect(finalOverlay).toBeDefined()
      
      if (finalOverlay.status === 'approved') {
        expect(finalOverlay.version).toBe(1)
      } else {
        expect(finalOverlay.status).toBe('pending')
        expect(finalOverlay.caption).toBe('User Modified Caption')
        expect(finalOverlay.version).toBe(2)
      }
    })

    test('concurrent overlay updates maintain data integrity', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id)
      const overlay = await TestHelpers.createTestOverlay(project.id, testUser.id, 1, { status: 'pending' })
      
      const userCaller = overlayRouter.createCaller(createUserContext(testUser.id))
      
      // AI : Multiple concurrent caption updates
      const updatePromises = Array(3).fill(null).map((_, index) =>
        userCaller.updateOverlay({
          id: overlay.id,
          caption: `Updated Caption ${index}`
        })
      )
      
      const results = await Promise.allSettled(updatePromises)
      
      // AI : All updates should succeed
      results.forEach(result => {
        expect(result.status).toBe('fulfilled')
      })
      
      // AI : Version should reflect all updates
      const finalVersion = await TestHelpers.getOverlayVersion(overlay.id)
      expect(finalVersion).toBe(4) // Started at 1, 3 updates
      
      // AI : Caption should be one of the update values
      const db = getTestDb()
      const [finalOverlay] = await db.select().from(overlays).where(eq(overlays.id, overlay.id)).limit(1)
      expect(finalOverlay.caption).toMatch(/^Updated Caption \d+$/)
    })
  })

  describe('Complex Multi-Entity Race Conditions', () => {
    test('concurrent project and overlay modifications with approvals', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id, 1, { status: 'pending' })
      const overlay = await TestHelpers.createTestOverlay(project.id, testUser.id, 1, { status: 'pending' })
      
      const userCaller = projectRouter.createCaller(createUserContext(testUser.id))
      const overlayCaller = overlayRouter.createCaller(createUserContext(testUser.id))
      const adminCaller = moderationRouter.createCaller(createAdminContext(testAdmin.id))
      
      // AI : Simulate complex concurrent scenario
      const operations = await Promise.allSettled([
        // User modifies project
        userCaller.publishProject({
          id: project.id,
          name: 'Modified Project',
          description: project.description ?? undefined,
          cityId: testCity.id,
        }),
        // User modifies overlay
        overlayCaller.updateOverlay({
          id: overlay.id,
          caption: 'Modified Overlay'
        }),
        // Admin tries to approve project
        adminCaller.setProjectApprovalStatusWithVersion({
          items: [{ id: project.id, expectedVersion: 1 }],
          status: 'approved'
        }),
        // Admin tries to approve overlay
        adminCaller.setOverlayApprovalStatusWithVersion({
          items: [{ id: overlay.id, expectedVersion: 1 }],
          status: 'approved'
        })
      ])
      
      // AI : User operations should succeed
      expect(operations[0].status).toBe('fulfilled') // Project edit
      expect(operations[1].status).toBe('fulfilled') // Overlay edit
      
      // AI : Verify final database state is consistent
      const db = getTestDb()
      const [finalProject] = await db.select().from(projects).where(eq(projects.id, project.id)).limit(1)
      const [finalOverlay] = await db.select().from(overlays).where(eq(overlays.id, overlay.id)).limit(1)
      
      expect(finalProject).toBeDefined()
      expect(finalOverlay).toBeDefined()
      
      // AI : Each entity should be in a consistent state (either approved or pending with modifications)
      if (finalProject.status === 'approved') {
        expect(finalProject.version).toBe(1)
      } else {
        expect(finalProject.version).toBe(2)
        expect(finalProject.name).toBe('Modified Project')
      }
      
      if (finalOverlay.status === 'approved') {
        expect(finalOverlay.version).toBe(1)
      } else {
        expect(finalOverlay.version).toBe(2)
        expect(finalOverlay.caption).toBe('Modified Overlay')
      }
    })

    test('stress test with high concurrency', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id, 1, { status: 'pending' })
      
      const userCaller = projectRouter.createCaller(createUserContext(testUser.id))
      const adminCaller = moderationRouter.createCaller(createAdminContext(testAdmin.id))
      
      // AI : Create 50 concurrent operations (25 edits + 25 approval attempts)
      const edits = Array(25).fill(null).map((_, i) =>
        userCaller.publishProject({
          id: project.id,
          name: `Edit ${i}`,
          description: project.description ?? undefined,
          cityId: testCity.id,
        })
      )
      
      const approvals = Array(25).fill(null).map(() =>
        adminCaller.setProjectApprovalStatusWithVersion({
          items: [{ id: project.id, expectedVersion: 1 }],
          status: 'approved'
        })
      )
      
      const allOperations = [...edits, ...approvals]
      const results = await Promise.allSettled(allOperations)
      
      // AI : All edit operations should succeed
      const editResults = results.slice(0, 25)
      editResults.forEach(result => {
        expect(result.status).toBe('fulfilled')
      })
      
      // AI : Final state should be consistent
      const db = getTestDb()
      const [finalProject] = await db.select().from(projects).where(eq(projects.id, project.id)).limit(1)
      expect(finalProject).toBeDefined()
      
      // AI : Version should be reasonable (at least 2, at most 26)
      expect(finalProject.version).toBeGreaterThanOrEqual(2)
      expect(finalProject.version).toBeLessThanOrEqual(26)
      
      // AI : Project should be either approved or pending
      expect(['approved', 'pending']).toContain(finalProject.status)
    })
  })

  describe('Database Transaction Integrity', () => {
    test('version increments are atomic with other field updates', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id, 1, { status: 'pending' })
      
      const userCaller = projectRouter.createCaller(createUserContext(testUser.id))
      
      // AI : Perform update that should increment version atomically
      await userCaller.publishProject({
        id: project.id,
        name: 'Atomically Updated Name',
        description: 'Atomically Updated Description',
        cityId: testCity.id,
      })
      
      // AI : Verify both name and version were updated together
      const db = getTestDb()
      const [updatedProject] = await db.select().from(projects).where(eq(projects.id, project.id)).limit(1)
      expect(updatedProject.name).toBe('Atomically Updated Name')
      expect(updatedProject.description).toBe('Atomically Updated Description') 
      expect(updatedProject.version).toBe(2)
    })

    test('failed approval leaves database unchanged', async () => {
      const project = await TestHelpers.createTestProject(testUser.id, testCity.id, 1, { status: 'pending' })
      
      // AI : Capture initial state
      const initialVersion = await TestHelpers.getProjectVersion(project.id)
      const db = getTestDb()
      const [initialProject] = await db.select().from(projects).where(eq(projects.id, project.id)).limit(1)
      
      // AI : Simulate version conflict
      await TestHelpers.simulateVersionConflict(project.id, 'project')
      
      const adminCaller = moderationRouter.createCaller(createAdminContext(testAdmin.id))
      const result = await adminCaller.setProjectApprovalStatusWithVersion({
        items: [{ id: project.id, expectedVersion: initialVersion }],
        status: 'approved'
      })
      
      expect(result.success).toBe(false)
      
      // AI : Verify project status didn't change despite failed approval
      const [finalProject] = await db.select().from(projects).where(eq(projects.id, project.id)).limit(1)
      expect(finalProject.status).toBe(initialProject.status)
      expect(finalProject.version).toBe(2) // Only incremented by the conflict simulation
    })
  })
})