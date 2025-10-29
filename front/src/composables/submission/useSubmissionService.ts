import { useProjectStore } from '@stores/pinia/projectStore'
import { useMapStore } from '@stores/pinia/mapStore'
import { trpc } from '@client'
import { buildProjectPayload } from '@composables/project/useProjectMutations'
import { loadCityProjects } from '@composables/map/useCityMarkers'
import { updateMarkerTooltip } from '@composables/overlay/useOverlay'
import type { Project, OverlayObject } from '@types'
import type { FieldChange } from '../../../../back/src/routes/changes'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { validateOverlaySize, leafletCornersToCorners } from '../../../../back/src/utils/overlayValidation'
import { useI18n } from 'vue-i18n'

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
  corners: 'Position',
  cityId: 'City'
}

export function useSubmissionService() {
  const projectStore = useProjectStore()
  const mapStore = useMapStore()
  const { currentCityOverlays } = storeToRefs(mapStore)
  const { t } = useI18n()

  // AI : Build a combined city name cache from store cache + projects we've seen
  const cityNamesCache = computed(() => {
    const cache: Record<string, string> = { ...projectStore.cityNamesCache }

    // AI : Extract city names from original backend projects (if not already in cache)
    Object.values(projectStore.originalBackendProjects).forEach(project => {
      if (project.city && project.cityId && !cache[project.cityId]) {
        cache[project.cityId] = project.city.name
      }
    })

    // AI : Extract from all projects (in case we have more cities)
    Object.values(projectStore.allProjects).forEach(project => {
      if (project.city && project.cityId && project.city.id === project.cityId && !cache[project.cityId]) {
        cache[project.cityId] = project.city.name
      }
    })

    return cache
  })

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

  // AI : Detect all changes for a project entity by fetching original from backend cache
  function detectProjectChanges(project: Project): FieldChange[] {
    const changes: FieldChange[] = []

    // AI : Try to find original project from the originalBackendProjects cache
    // This cache stores snapshots of approved projects before local modifications
    const originalProject = projectStore.originalBackendProjects[project.id]

    if (!originalProject) {
      // AI : No original version found in cache - might be a new/pending project
      return changes
    }

    const fieldsToCheck: Array<keyof Project> = [
      'name',
      'description',
      'sourceUrl',
      'proposalDate',
      'startDate',
      'endDate',
      'latestUpdateOn',
      'cityId'
    ]

    fieldsToCheck.forEach(field => {
      const oldValue = originalProject[field]
      const newValue = project[field]

      // AI : Normalize dates for comparison (handle Date objects vs yyyy-MM-dd strings)
      const normalizeDate = (val: any): string | null => {
        if (!val) return null
        if (val instanceof Date) return val.toISOString().split('T')[0] // AI : Get yyyy-MM-dd part
        if (typeof val === 'string') return val.split('T')[0] // AI : Handle ISO strings or yyyy-MM-dd
        return null
      }

      // AI : Special handling for date fields
      const isDateField = ['proposalDate', 'startDate', 'endDate', 'latestUpdateOn'].includes(String(field))

      if (isDateField) {
        const normalizedOld = normalizeDate(oldValue)
        const normalizedNew = normalizeDate(newValue)

        if (normalizedOld !== normalizedNew) {
          changes.push({
            fieldName: String(field),
            oldValue: normalizedOld,
            newValue: normalizedNew,
            changeReason: `User modified ${field}`
          })
        }
      } else if (oldValue !== newValue) {
        // AI : For non-date fields, direct comparison
        changes.push({
          fieldName: String(field),
          // @ts-expect-error - Complex union types from Project fields don't match strict JSONType
          oldValue: oldValue ?? null,
          // @ts-expect-error - Complex union types from Project fields don't match strict JSONType
          newValue: newValue ?? null,
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
  function formatValueForDisplay(value: any, fieldName?: string): string {
    if (value === null || value === undefined || value === '') {
      return 'Not set'
    }

    // AI : Special handling for cityId - show city name
    if (fieldName === 'cityId' && typeof value === 'string') {
      // AI : Check the cache (built from all projects and loaded cities)
      const cachedName = cityNamesCache.value[value]
      if (cachedName) {
        return cachedName
      }
      return value // AI : Fallback to ID if city name not found
    }

    // AI : Special handling for projectId - show project name
    if (fieldName === 'projectId' && typeof value === 'string') {
      const project = projectStore.allProjects[value]
      if (project?.name) {
        return project.name
      }
      return value // AI : Fallback to ID if project not found
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
      oldValue: formatValueForDisplay(change.oldValue, change.fieldName),
      newValue: formatValueForDisplay(change.newValue, change.fieldName),
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
      } else {
        // AI : Validate overlay size constraints
        const cornersArray = overlay.overlay 
          ? leafletCornersToCorners(overlay.overlay.getCorners())
          : overlay.corners.map(c => ({ lat: c.lat, lng: c.lng }))
        
        const sizeValidation = validateOverlaySize(cornersArray)
        if (!sizeValidation.isValid) {
          // AI : Simple i18n error message
          errors.push(t('overlay.overlayTooLarge'))
        }
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

      // AI : Reset modified flag after successfully submitting change request
      projectStore.updateProject(project.id, { isModified: false })
    } else {
      // AI : Direct update for pending/new projects
      const publishResult = await trpc.project.publishProject.mutate(
        buildProjectPayload(project)
      )

      if (publishResult.success) {
        // AI : Reset modified flag after successful publish
        projectStore.updateProject(project.id, { isModified: false })

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

      // AI : Reset modified flag and set pending changes flag after successfully submitting change request
      overlay.isModified = false
      overlay.hasPendingChanges = true
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
