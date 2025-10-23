import { useProjectStore } from '@stores/pinia/projectStore'
import { useMapStore } from '@stores/pinia/mapStore'
import { trpc } from '@client'
import { buildProjectPayload } from '@composables/project/useProjectMutations'
import { loadCityProjects } from '@composables/map/useCityMarkers'
import { updateMarkerTooltip } from '@composables/overlay/useOverlay'
import type { Project, OverlayObject } from '@types'
import type { FieldChange } from '../../../../back/src/routes/changes'
import { storeToRefs } from 'pinia'

// AI : Unified submission types for consolidated workflow
export type SubmissionChangeType = 'create' | 'update_pending' | 'update_approved'
export type SubmissionEntityType = 'project' | 'overlay'

export interface SubmissionContext {
  entityType: SubmissionEntityType
  entityId: string
  entity: any // AI : Use any to avoid strict type checking issues with Leaflet overlay objects
  changeType: SubmissionChangeType
  changedFields?: FieldChange[]
}

export interface SubmissionChange {
  field: string
  oldValue: any
  newValue: any
  displayLabel: string
}

export interface SubmissionSummary {
  action: string
  entityName: string
  changes: SubmissionChange[]
  requiresModeration: boolean
  entityType: SubmissionEntityType
}

export interface ValidationResult {
  isValid: boolean
  errors: string[]
}

// AI : Field display names for user-friendly labels in UI
const FIELD_DISPLAY_NAMES: Record<string, string> = {
  name: 'Project Name',
  description: 'Description',
  sourceUrl: 'Source URL',
  proposalDate: 'Proposal Date',
  startDate: 'Start Date',
  endDate: 'End Date',
  latestUpdateOn: 'Latest Update',
  caption: 'Overlay Caption',
  projectId: 'Parent Project',
  corners: 'Position'
}

export function useSubmissionService() {
  const projectStore = useProjectStore()
  const mapStore = useMapStore()
  const { currentCityOverlays } = storeToRefs(mapStore)

  // AI : Determine submission change type based on entity status
  function getChangeType(entity: Project | OverlayObject): SubmissionChangeType {
    if (!entity.id || entity.id.startsWith('temp-')) {
      return 'create'
    }

    if (entity.status === 'pending' || entity.status === 'rejected') {
      return 'update_pending'
    }

    if (entity.status === 'approved') {
      return 'update_approved'
    }

    return 'create'
  }

  // AI : Detect all changes for a project entity
  function detectProjectChanges(project: Project): FieldChange[] {
    const changes: FieldChange[] = []

    // AI : Get original data for comparison (stored when user edited in edit mode)
    const originalData = project.originalData
    if (!originalData) {
      return changes
    }

    const fieldsToCheck: Array<keyof typeof originalData> = [
      'name',
      'description',
      'sourceUrl',
      'proposalDate',
      'startDate',
      'endDate',
      'latestUpdateOn'
    ]

    fieldsToCheck.forEach(field => {
      const oldValue = originalData[field]
      const newValue = project[field]

      // AI : Handle Date comparison (convert to ISO string for JSON compatibility)
      if (oldValue instanceof Date && newValue instanceof Date) {
        if (oldValue.getTime() !== newValue.getTime()) {
          changes.push({
            fieldName: String(field),
            oldValue: oldValue.toISOString(),
            newValue: newValue.toISOString(),
            changeReason: `User modified ${field}`
          })
        }
      } else if (oldValue !== newValue) {
        // AI : Convert dates to ISO strings if present
        const convertedOldValue = oldValue instanceof Date ? oldValue.toISOString() : (oldValue ?? null)
        const convertedNewValue = newValue instanceof Date ? newValue.toISOString() : (newValue ?? null)

        changes.push({
          fieldName: String(field),
          // @ts-expect-error - Complex union types from Project fields don't match strict JSONType
          oldValue: convertedOldValue,
          // @ts-expect-error - Complex union types from Project fields don't match strict JSONType
          newValue: convertedNewValue,
          changeReason: `User modified ${field}`
        })
      }
    })

    return changes
  }

  // AI : Detect all changes for an overlay entity
  function detectOverlayChanges(overlay: OverlayObject): FieldChange[] {
    const changes: FieldChange[] = []

    // AI : Find original overlay data from backend (approved version)
    const originalOverlay = currentCityOverlays.value.find(o => o.id === overlay.id)
    if (!originalOverlay) {
      // AI : If no original found, this is a new overlay or we can't detect changes
      return changes
    }

    // AI : Check projectId change
    if (overlay.projectId !== originalOverlay.projectId) {
      changes.push({
        fieldName: 'projectId',
        oldValue: originalOverlay.projectId,
        newValue: overlay.projectId,
        changeReason: 'User changed the parent project'
      })
    }

    // AI : Check caption change
    if (overlay.caption !== originalOverlay.caption) {
      changes.push({
        fieldName: 'caption',
        oldValue: originalOverlay.caption ?? null,
        newValue: overlay.caption,
        changeReason: 'User modified the overlay caption'
      })
    }

    // AI : Check corner positions (use current Leaflet corners if available)
    const currentCorners = overlay.overlay
      ? overlay.overlay.getCorners().map(c => ({ lat: c.lat, lng: c.lng }))
      : overlay.corners

    const normalizedCurrentCorners = currentCorners.map(c => ({ lat: c.lat, lng: c.lng }))
    const normalizedOriginalCorners = originalOverlay.corners.map(c => ({ lat: c.lat, lng: c.lng }))

    if (JSON.stringify(normalizedCurrentCorners) !== JSON.stringify(normalizedOriginalCorners)) {
      changes.push({
        fieldName: 'corners',
        oldValue: normalizedOriginalCorners,
        newValue: normalizedCurrentCorners,
        changeReason: 'User moved, rotated, or scaled the overlay'
      })
    }

    return changes
  }

  // AI : Unified change detection for any entity
  function detectChanges(context: SubmissionContext): FieldChange[] {
    if (context.changedFields) {
      return context.changedFields
    }

    if (context.entityType === 'project') {
      return detectProjectChanges(context.entity as Project)
    } else {
      return detectOverlayChanges(context.entity as OverlayObject)
    }
  }

  // AI : Format value for human-readable display
  function formatValueForDisplay(value: any): string {
    if (value === null || value === undefined || value === '') {
      return 'Not set'
    }
    if (value instanceof Date) {
      return value.toLocaleDateString()
    }
    if (typeof value === 'number') {
      return value.toFixed(6)
    }
    if (Array.isArray(value)) {
      return `[${value.length} items]`
    }
    if (typeof value === 'object') {
      return JSON.stringify(value)
    }
    return String(value)
  }

  // AI : Build human-readable summary for confirmation dialog
  function buildSummary(context: SubmissionContext): SubmissionSummary {
    const changes = detectChanges(context)
    const entityName = context.entityType === 'project'
      ? (context.entity as Project).name
      : (context.entity as OverlayObject).caption ?? 'Unnamed Overlay'

    let action: string
    let requiresModeration: boolean

    switch (context.changeType) {
      case 'create':
        action = `Create new ${context.entityType}`
        requiresModeration = true
        break
      case 'update_pending':
        action = `Update pending ${context.entityType}`
        requiresModeration = false
        break
      case 'update_approved':
        action = `Suggest changes to approved ${context.entityType}`
        requiresModeration = true
        break
    }

    const formattedChanges: SubmissionChange[] = changes.map(change => ({
      field: change.fieldName,
      oldValue: formatValueForDisplay(change.oldValue),
      newValue: formatValueForDisplay(change.newValue),
      displayLabel: FIELD_DISPLAY_NAMES[change.fieldName] ?? change.fieldName
    }))

    return {
      action,
      entityName,
      changes: formattedChanges,
      requiresModeration,
      entityType: context.entityType
    }
  }

  // AI : Validate submission before proceeding
  function validate(context: SubmissionContext): ValidationResult {
    const errors: string[] = []

    // AI : Project-specific validation
    if (context.entityType === 'project') {
      const project = context.entity as Project

      if (!project.name || project.name.trim().length < 8) {
        errors.push('Project name must be at least 8 characters long')
      }

      if (!project.cityId) {
        errors.push('Project must be assigned to a city')
      }
    }

    // AI : Overlay-specific validation
    if (context.entityType === 'overlay') {
      const overlay = context.entity as OverlayObject

      if (!overlay.projectId) {
        errors.push('Overlay must be assigned to a project')
      }

      const corners = overlay.overlay?.getCorners() ?? overlay.corners
      if (!corners || corners.length !== 4 || corners.some(c => !c.lat || !c.lng)) {
        errors.push('Overlay must have valid position (4 corners)')
      }
    }

    // AI : Check if there are any changes to submit (for updates)
    if (context.changeType !== 'create') {
      const changes = detectChanges(context)
      if (changes.length === 0) {
        errors.push('No changes detected to submit')
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  // AI : Submit project changes to backend
  async function submitProject(context: SubmissionContext, changes: FieldChange[]): Promise<void> {
    const project = context.entity as Project

    if (context.changeType === 'update_approved') {
      // AI : Submit change requests for approved projects
      await trpc.changes.submitChangeRequest.mutate({
        entityType: 'project',
        entityId: project.id,
        changes
      })

      // AI : Mark project as having unsaved changes pending moderation
      projectStore.updateProject(project.id, {
        savedRemotely: false
      })
    } else {
      // AI : Direct update for pending/new projects
      const publishResult = await trpc.project.publishProject.mutate(
        buildProjectPayload(project)
      )

      if (publishResult.success) {
        // AI : Mark project as saved remotely
        projectStore.updateProject(project.id, {
          savedRemotely: true
        })

        // AI : Refresh city projects to show updated marker
        if (mapStore.selectedCity) {
          await loadCityProjects(
            mapStore.selectedCity.id,
            mapStore.selectedCity.name,
            true,
            mapStore.selectedCity.countryCode
          )
        } else {
          await loadCityProjects(null, '', true)
        }
      } else {
        throw new Error('Backend publish failed')
      }
    }
  }

  // AI : Submit overlay changes to backend
  async function submitOverlay(context: SubmissionContext, changes: FieldChange[]): Promise<void> {
    const overlay = context.entity as OverlayObject

    if (context.changeType === 'update_approved') {
      // AI : Submit change requests for approved overlays
      if (changes.length === 0) {
        throw new Error('No changes detected for approved overlay')
      }

      await trpc.changes.submitChangeRequest.mutate({
        entityType: 'overlay',
        entityId: overlay.id,
        changes
      })

      // AI : Reset modified flag after successfully submitting change request
      overlay.isModified = false
      updateMarkerTooltip(overlay)
    } else if (context.changeType === 'update_pending') {
      // AI : Direct update for pending overlays
      const overlayData: { id: string; caption?: string } = { id: overlay.id }

      changes.forEach(change => {
        if (change.fieldName === 'caption') {
          overlayData.caption = String(change.newValue ?? '')
        }
      })

      await trpc.overlay.updateOverlay.mutate(overlayData)
    } else {
      // AI : Create new overlay - this is handled by useOverlayPublisher
      throw new Error('New overlay creation should use useOverlayPublisher directly')
    }
  }

  // AI : Unified submission handler - routes to correct backend API
  async function submit(context: SubmissionContext): Promise<void> {
    // AI : Validate first
    const validation: ValidationResult = validate(context)
    if (!validation.isValid) {
      throw new Error(validation.errors.join(', '))
    }

    // AI : Detect changes with explicit type
    const changes: FieldChange[] = detectChanges(context)

    // AI : Route to appropriate submission handler
    if (context.entityType === 'project') {
      await submitProject(context, changes)
    } else {
      await submitOverlay(context, changes)
    }
  }

  return {
    getChangeType,
    detectChanges,
    buildSummary,
    validate,
    submit
  }
}
