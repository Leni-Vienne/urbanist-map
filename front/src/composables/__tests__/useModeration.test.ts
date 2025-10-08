import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import type { ProjectForModeration } from '@types'

// AI : Mock Vue's onMounted to prevent issues with lifecycle hooks in tests  
vi.mock('vue', async () => {
  const actual = await vi.importActual('vue')
  return {
    ...actual,
    onMounted: vi.fn((callback: () => void) => {
      // Call the callback immediately in tests instead of waiting for mount
      callback()
    })
  }
})

// AI : Mock the tRPC client - define mock functions inline to avoid hoisting issues
vi.mock('@client', () => ({
  trpc: {
    moderation: {
      getPendingSubmissions: {
        query: vi.fn()
      },
      setProjectApprovalStatusWithVersion: {
        mutate: vi.fn()
      },
      setOverlayApprovalStatusWithVersion: {
        mutate: vi.fn()
      },
      undoProjectApprovalStatus: {
        mutate: vi.fn()
      },
      undoOverlayApprovalStatus: {
        mutate: vi.fn()
      }
    }
  }
}))

import { useModeration } from '../overlay/useModeration'
import { trpc } from '@client'

// AI : Type-safe mock - cast to MockedFunction type
const mockTrpc = {
  moderation: {
    getPendingSubmissions: {
      query: vi.mocked(trpc.moderation.getPendingSubmissions.query)
    },
    setProjectApprovalStatusWithVersion: {
      mutate: vi.mocked(trpc.moderation.setProjectApprovalStatusWithVersion.mutate)
    },
    setOverlayApprovalStatusWithVersion: {
      mutate: vi.mocked(trpc.moderation.setOverlayApprovalStatusWithVersion.mutate)
    },
    undoProjectApprovalStatus: {
      mutate: vi.mocked(trpc.moderation.undoProjectApprovalStatus.mutate)
    },
    undoOverlayApprovalStatus: {
      mutate: vi.mocked(trpc.moderation.undoOverlayApprovalStatus.mutate)
    }
  }
}

// AI : Sample test data
const mockProject: ProjectForModeration = {
  id: 'test-project-1',
  name: 'Test Project',
  description: 'Test Description',
  status: 'pending',
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  startDate: null,
  endDate: null,
  sourceUrl: null,
  isMarker: false,
  lat: null,
  lng: null,
  cityId: 'test-city-1',
  cityName: 'Test City',
  countryCode: 'TST',
  countryName: 'Test Country',
  overlays: [],
  overlayCount: 0
}

const mockOverlay = {
  id: 'test-overlay-1',
  name: 'Test Overlay',
  filename: 'test.jpg',
  status: 'pending' as const,
  version: 1,
  projectId: 'test-project-1',
  updatedAt: new Date(),
  cityId: 'test-city-1',
  cityName: 'Test City',
  countryCode: 'TST',
  countryName: 'Test Country'
}

describe('useModeration Composable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    
    // AI : Default mock implementations - prevent infinite calls with limited call counts
    mockTrpc.moderation.getPendingSubmissions.query
      .mockResolvedValueOnce({
        projects: [mockProject],
        overlays: [mockOverlay],
        changeRequests: []
      })
      .mockResolvedValue({
        projects: [mockProject],
        overlays: [mockOverlay], 
        changeRequests: []
      })
    
    mockTrpc.moderation.setProjectApprovalStatusWithVersion.mutate
      .mockResolvedValue({
        success: true
      })
    
    mockTrpc.moderation.setOverlayApprovalStatusWithVersion.mutate
      .mockResolvedValue({
        success: true
      })
      
    mockTrpc.moderation.undoProjectApprovalStatus.mutate
      .mockResolvedValue({
        success: true
      })
      
    mockTrpc.moderation.undoOverlayApprovalStatus.mutate
      .mockResolvedValue({
        success: true
      })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Project Approval with Version Validation', () => {
    test('approves project successfully with correct version', async () => {
      const { approveProject, projects } = useModeration()
      
      // AI : Wait for onMounted to complete and populate data
      await vi.waitFor(() => {
        expect(projects.value).toHaveLength(1)
      })
      
      const result = await approveProject('test-project-1')
      
      expect(result.success).toBe(true)
      expect(result.itemName).toBe('Test Project')
      expect(mockTrpc.moderation.setProjectApprovalStatusWithVersion.mutate).toHaveBeenCalledWith({
        id: 'test-project-1',
        expectedVersion: 1,
        status: 'approved'
      })
    })

    test('handles version conflict for project approval', async () => {
      const { approveProject, projects } = useModeration()
      
      // AI : Wait for initial data population
      await vi.waitFor(() => {
        expect(projects.value).toHaveLength(1)
      })
      
      // AI : Clear previous calls and setup version conflict response
      mockTrpc.moderation.setProjectApprovalStatusWithVersion.mutate.mockClear()
      mockTrpc.moderation.setProjectApprovalStatusWithVersion.mutate.mockResolvedValueOnce({
        success: false,
        error: 'Version mismatch',
        expectedVersion: 1,
        currentVersion: 2
      })
      
      const result = await approveProject('test-project-1')
      
      expect(result.success).toBe(false)
      expect(result.error).toBe('version_conflict')
      expect(result.message).toContain('modified by another user')
      expect(result.itemName).toBe('Test Project')
    })

    test('handles project not found error', async () => {
      const { approveProject } = useModeration()
      
      // AI : Mock project not found in local data
      mockTrpc.moderation.getPendingSubmissions.query.mockResolvedValue({
        projects: [], // Empty - project not found
        overlays: [],
        changeRequests: []
      })
      
      const result = await approveProject('non-existent-project')
      
      expect(result.success).toBe(false)
      expect(result.error).toBe('not_found')
      expect(result.message).toBe('Project not found')
    })

    test('handles API error gracefully', async () => {
      const { approveProject, projects } = useModeration()
      
      // AI : Wait for initial data population
      await vi.waitFor(() => {
        expect(projects.value).toHaveLength(1)
      })
      
      // AI : Clear and setup API error
      mockTrpc.moderation.setProjectApprovalStatusWithVersion.mutate.mockClear()
      mockTrpc.moderation.setProjectApprovalStatusWithVersion.mutate.mockRejectedValueOnce(
        new Error('Network error')
      )
      
      const result = await approveProject('test-project-1')
      
      expect(result.success).toBe(false)
      expect(result.error).toBe('unknown')
      expect(result.message).toContain('Failed to approve project')
    })

    test('rejects project successfully', async () => {
      const { rejectProject, projects } = useModeration()
      
      // AI : Wait for initial data population
      await vi.waitFor(() => {
        expect(projects.value).toHaveLength(1)
      })
      
      const result = await rejectProject('test-project-1')
      
      expect(result.success).toBe(true)
      expect(result.itemName).toBe('Test Project')
      expect(mockTrpc.moderation.setProjectApprovalStatusWithVersion.mutate).toHaveBeenCalledWith({
        id: 'test-project-1',
        expectedVersion: 1,
        status: 'rejected'
      })
    })
  })

  describe('Overlay Approval with Version Validation', () => {
    test('approves overlay successfully with correct version', async () => {
      const { approveOverlay, overlays } = useModeration()
      
      // AI : Wait for initial data population
      await vi.waitFor(() => {
        expect(overlays.value).toHaveLength(1)
      })
      
      const result = await approveOverlay('test-overlay-1')
      
      expect(result.success).toBe(true)
      expect(result.itemName).toBe('Test Overlay')
      expect(mockTrpc.moderation.setOverlayApprovalStatusWithVersion.mutate).toHaveBeenCalledWith({
        id: 'test-overlay-1',
        expectedVersion: 1,
        status: 'approved'
      })
    })

    test('handles version conflict for overlay approval', async () => {
      const { approveOverlay, overlays } = useModeration()
      
      // AI : Wait for initial data population
      await vi.waitFor(() => {
        expect(overlays.value).toHaveLength(1)
      })
      
      // AI : Clear and setup version conflict
      mockTrpc.moderation.setOverlayApprovalStatusWithVersion.mutate.mockClear()
      mockTrpc.moderation.setOverlayApprovalStatusWithVersion.mutate.mockResolvedValueOnce({
        success: false,
        error: 'Version mismatch',
        expectedVersion: 1,
        currentVersion: 3
      })
      
      const result = await approveOverlay('test-overlay-1')
      
      expect(result.success).toBe(false)
      expect(result.error).toBe('version_conflict')
      expect(result.message).toContain('modified by another user')
      expect(result.itemName).toBe('Test Overlay')
    })

    test('rejects overlay successfully', async () => {
      const { rejectOverlay, overlays } = useModeration()
      
      // AI : Wait for initial data population
      await vi.waitFor(() => {
        expect(overlays.value).toHaveLength(1)
      })
      
      const result = await rejectOverlay('test-overlay-1')
      
      expect(result.success).toBe(true)
      expect(result.itemName).toBe('Test Overlay')
      expect(mockTrpc.moderation.setOverlayApprovalStatusWithVersion.mutate).toHaveBeenCalledWith({
        id: 'test-overlay-1',
        expectedVersion: 1,
        status: 'rejected'
      })
    })
  })

  describe('Recent Actions and Undo Functionality', () => {
    test('tracks recent actions for approved projects', async () => {
      const { approveProject, recentActions, projects } = useModeration()
      
      // AI : Wait for initial data population
      await vi.waitFor(() => {
        expect(projects.value).toHaveLength(1)
      })
      
      await approveProject('test-project-1')
      await nextTick()
      
      expect(recentActions.value).toHaveLength(1)
      expect(recentActions.value[0]).toMatchObject({
        id: 'test-project-1',
        itemName: 'Test Project',
        itemType: 'project',
        previousStatus: 'pending',
        newStatus: 'approved'
      })
    })

    test('tracks recent actions for rejected overlays', async () => {
      const { rejectOverlay, recentActions, overlays } = useModeration()
      
      // AI : Wait for initial data population
      await vi.waitFor(() => {
        expect(overlays.value).toHaveLength(1)
      })
      
      await rejectOverlay('test-overlay-1')
      await nextTick()
      
      expect(recentActions.value).toHaveLength(1)
      expect(recentActions.value[0]).toMatchObject({
        id: 'test-overlay-1',
        itemName: 'Test Overlay',
        itemType: 'overlay',
        previousStatus: 'pending',
        newStatus: 'rejected'
      })
    })

    test('does not track actions for failed approvals', async () => {
      const { approveProject, recentActions } = useModeration()
      
      mockTrpc.moderation.setProjectApprovalStatusWithVersion.mutate.mockResolvedValue({
        success: false,
        error: 'Version mismatch'
      })
      
      await approveProject('test-project-1')
      await nextTick()
      
      expect(recentActions.value).toHaveLength(0)
    })

    test('limits recent actions to 5 items', async () => {
      // AI : Create multiple test projects
      const multipleProjects = Array(7).fill(null).map((_, i) => ({
        ...mockProject,
        id: `test-project-${i}`,
        name: `Test Project ${i}`
      }))
      
      // AI : Override mock BEFORE creating useModeration instance
      mockTrpc.moderation.getPendingSubmissions.query.mockReset()
      mockTrpc.moderation.getPendingSubmissions.query.mockResolvedValue({
        projects: multipleProjects,
        overlays: [],
        changeRequests: []
      })
      
      const { approveProject, recentActions, projects } = useModeration()
      
      // AI : Wait for initial data to populate with 7 projects
      await vi.waitFor(() => {
        expect(projects.value).toHaveLength(7)
      })
      
      // AI : Approve 7 projects
      for (let i = 0; i < 7; i++) {
        await approveProject(`test-project-${i}`)
      }
      await nextTick()
      
      expect(recentActions.value).toHaveLength(5)
      expect(recentActions.value[0].itemName).toBe('Test Project 6') // Most recent
      expect(recentActions.value[4].itemName).toBe('Test Project 2') // 5th most recent
    })

    test('undo last action calls correct endpoint', async () => {
      const { approveProject, undoLastAction, recentActions, projects } = useModeration()
      
      // AI : Wait for initial data population
      await vi.waitFor(() => {
        expect(projects.value).toHaveLength(1)
      })
      
      await approveProject('test-project-1')
      expect(recentActions.value).toHaveLength(1)
      
      const undoResult = await undoLastAction()
      
      expect(undoResult).toBe(true)
      expect(mockTrpc.moderation.undoProjectApprovalStatus.mutate).toHaveBeenCalledWith({
        id: 'test-project-1',
        status: 'pending'
      })
      expect(recentActions.value).toHaveLength(0)
    })
  })

  describe('Data Management', () => {
    test('fetches pending submissions on mount', async () => {
      const { projects } = useModeration()
      
      // AI : Wait for onMounted to trigger the fetch
      await vi.waitFor(() => {
        expect(projects.value).toHaveLength(1)
      })
      
      expect(mockTrpc.moderation.getPendingSubmissions.query).toHaveBeenCalled()
    })

    test('refreshes data after successful operations', async () => {
      const { approveProject, projects } = useModeration()
      
      // AI : Wait for initial data population
      await vi.waitFor(() => {
        expect(projects.value).toHaveLength(1)
      })
      
      // AI : Clear call count and track refresh calls
      const initialCallCount = mockTrpc.moderation.getPendingSubmissions.query.mock.calls.length
      
      await approveProject('test-project-1')
      
      // AI : Should have called again for refresh after approval
      expect(mockTrpc.moderation.getPendingSubmissions.query).toHaveBeenCalledTimes(initialCallCount + 1)
    })

    test('refreshes data after version conflicts', async () => {
      const { approveProject, projects } = useModeration()
      
      // AI : Wait for initial data population
      await vi.waitFor(() => {
        expect(projects.value).toHaveLength(1)
      })
      
      // AI : Setup version conflict
      mockTrpc.moderation.setProjectApprovalStatusWithVersion.mutate.mockClear()
      mockTrpc.moderation.setProjectApprovalStatusWithVersion.mutate.mockResolvedValueOnce({
        success: false,
        error: 'Version mismatch'
      })
      
      const initialCallCount = mockTrpc.moderation.getPendingSubmissions.query.mock.calls.length
      
      await approveProject('test-project-1')
      
      // AI : Should refresh data to show updated version
      expect(mockTrpc.moderation.getPendingSubmissions.query).toHaveBeenCalledTimes(initialCallCount + 1)
    })

    test('handles API errors without crashing', async () => {
      const { approveProject } = useModeration()
      
      mockTrpc.moderation.getPendingSubmissions.query.mockRejectedValue(new Error('API Error'))
      
      const result = await approveProject('test-project-1')
      
      // AI : Should still return error gracefully
      expect(result.success).toBe(false)
      expect(result.error).toBe('not_found') // Since getPendingSubmissions failed, project won't be found
    })
  })

  describe('Edge Cases', () => {
    test('handles empty projects list', async () => {
      const { approveProject } = useModeration()
      
      mockTrpc.moderation.getPendingSubmissions.query.mockResolvedValue({
        projects: [],
        overlays: [],
        changeRequests: []
      })
      
      const result = await approveProject('non-existent')
      
      expect(result.success).toBe(false)
      expect(result.error).toBe('not_found')
    })

    test('handles projects without names', async () => {
      const projectWithoutName = {
        ...mockProject,
        name: null as any // Invalid but possible edge case
      }
      
      // AI : Override mock BEFORE creating useModeration instance
      mockTrpc.moderation.getPendingSubmissions.query.mockReset()
      mockTrpc.moderation.getPendingSubmissions.query.mockResolvedValue({
        projects: [projectWithoutName],
        overlays: [],
        changeRequests: []
      })
      
      const { approveProject, projects } = useModeration()
      
      // AI : Wait for initial data to populate with null name
      await vi.waitFor(() => {
        expect(projects.value).toHaveLength(1)
      })
      
      const result = await approveProject('test-project-1')
      
      expect(result.success).toBe(true)
      expect(result.itemName).toBe('Unknown Project') // Fallback name
    })

    test('handles overlays without names', async () => {
      const overlayWithoutName = {
        ...mockOverlay,
        name: null as any
      }
      
      // AI : Override mock BEFORE creating useModeration instance
      mockTrpc.moderation.getPendingSubmissions.query.mockReset()
      mockTrpc.moderation.getPendingSubmissions.query.mockResolvedValue({
        projects: [{ ...mockProject, overlays: [overlayWithoutName] }],
        overlays: [overlayWithoutName],
        changeRequests: []
      })
      
      const { approveOverlay, overlays } = useModeration()
      
      // AI : Wait for initial data to populate with null name
      await vi.waitFor(() => {
        expect(overlays.value).toHaveLength(1)
      })
      
      const result = await approveOverlay('test-overlay-1')
      
      expect(result.success).toBe(true)
      expect(result.itemName).toBe('Unknown') // Fallback name
    })
  })
})