import { ref, computed, reactive, toRaw } from 'vue'
import { useChangeRequests } from '@composables/changes/useChanges'
import { useToast } from '@composables/ui/useToast'
import { useI18n } from '@composables/useI18n'
import { buildProjectPayload } from '@composables/project/useProjectMutations'
import { useProjectStore } from '@stores/pinia/projectStore'
import { updateStandaloneProjectMarkerColor } from '@composables/map/useCityMarkers'
import { trpc } from '@client'
import { formatDate } from '@utils/dateFormat'
import type { Project } from '@types'
import type { DBCity } from '../../../../back/src/shared/schema'

// AI : Type for overlay update payload based on updateOverlaySchema
interface OverlayUpdateData {
  id: string
  caption?: string
}

export interface FieldChange {
  fieldName: string
  oldValue: any
  newValue: any
  changeReason?: string
}

export interface EditableFormOptions<T> {
  entityType: 'project' | 'overlay'
  entityId: string
  initialData: T
  entityStatus?: 'pending' | 'approved' | 'rejected' | 'replaced' | null
  localOnly?: boolean // AI : If true, only update local store, don't submit to backend
  getAvailableCities?: () => Array<{ id: string; name: string; countryCode: string; lat: number; lng: number; distance?: number }> // AI : Function to get current cities dynamically
  onSubmitted?: () => void
  onClose?: () => void
}

export function useEditableForm<T extends Record<string, any>>(options: EditableFormOptions<T>) {
  const { submitMultipleFieldChanges } = useChangeRequests()
  const toast = useToast()
  const { t } = useI18n()
  const projectStore = useProjectStore()

  const isSubmitting = ref(false)
  const changeReason = ref('')
  
  // AI : Create reactive objects for original and current data
  const originalData = reactive({ ...options.initialData })
  const formData = reactive({ ...options.initialData })

  // AI : Check if a specific field has changed
  function hasChanged(fieldName: keyof T): boolean {
    const rawOriginal = toRaw(originalData) as T
    const rawForm = toRaw(formData) as T
    const original: any = rawOriginal[fieldName]
    const current: any = rawForm[fieldName]

    // AI : Handle Date objects by comparing their time values
    if (original instanceof Date && current instanceof Date) {
      return original.getTime() !== current.getTime()
    }

    // AI : Handle cases where one is Date and other is null/undefined
    if ((original instanceof Date && !current) || (!original && current instanceof Date)) {
      return true
    }

    return original !== current
  }

  // AI : Check if any field has changed
  const hasChanges = computed(() => {
    return Object.keys(formData).some(key => hasChanged(key as keyof T))
  })

  // AI : Reset all changes
  function resetChanges() {
    Object.assign(formData, originalData)
    changeReason.value = ''
  }

  // AI : Get array of changes to submit
  function getChangesToSubmit(): FieldChange[] {
    const changes: FieldChange[] = []
    const rawOriginal = toRaw(originalData) as T
    const rawForm = toRaw(formData) as T

    Object.keys(formData).forEach(key => {
      const fieldName = key as keyof T
      if (hasChanged(fieldName)) {
        changes.push({
          fieldName: String(fieldName),
          oldValue: rawOriginal[fieldName],
          newValue: rawForm[fieldName],
          changeReason: changeReason.value ?? undefined
        })
      }
    })

    return changes
  }

  // AI : Format value for display in change indicators
  function formatValue(value: any): string {
    if (value === null || value === undefined || value === '') {
      return 'Not set'
    }
    if (value instanceof Date) {
      return formatDate(value)
    }
    if (typeof value === 'number') {
      return value.toFixed(6)
    }
    return String(value)
  }

  // AI : Get CSS classes for a field based on change status
  function getFieldClasses(fieldName: keyof T) {
    return {
      'field-changed': hasChanged(fieldName)
    }
  }

  // AI : Validate project name meets minimum length requirement
  function validateProjectName(): boolean {
    if (options.entityType === 'project' && formData.name) {
      const trimmedName = String(formData.name).trim()
      if (trimmedName.length < 8) {
        toast.add({
          severity: 'error',
          summary: t('toast.validationError'),
          detail: t('project.nameTooShort'),
          life: 3000
        })
        return false
      }
    }
    return true
  }

  // AI : Update city object when cityId changes
  function getCityObjectForUpdate(currentProject: Project): DBCity {
    let cityObject: DBCity = currentProject.city
    
    if (formData.cityId && formData.cityId !== currentProject.cityId && options.getAvailableCities) {
      const citiesArray = options.getAvailableCities()
      const newCity = citiesArray.find(c => c.id === formData.cityId)
      if (newCity) {
        cityObject = {
          id: newCity.id,
          name: newCity.name,
          countryCode: newCity.countryCode,
          coordinates: { x: newCity.lng, y: newCity.lat },
          createdAt: new Date(),
          updatedAt: new Date()
        }
      }
    }
    
    return cityObject
  }

  // AI : Handle local-only project updates (no backend submission)
  function handleLocalOnlyUpdate() {
    if (options.entityType !== 'project') return

    let currentProject = projectStore.projects[options.entityId] ?? projectStore.allProjects[options.entityId]
    
    if (!currentProject) {
      console.error('[useEditableForm] PROJECT NOT FOUND AT ALL!')
      return
    }

    const cityObject = getCityObjectForUpdate(currentProject)
    const updatedData = {
      ...currentProject,
      ...formData as any,
      city: cityObject,
      isModified: true
    }
    
    projectStore.updateProject(options.entityId, updatedData)

    const updatedProject = projectStore.projects[options.entityId]
    const hasNoOverlays = !updatedProject?.overlayIds || updatedProject.overlayIds.length === 0
    if (updatedProject && hasNoOverlays) {
      updateStandaloneProjectMarkerColor(options.entityId, updatedProject)
    }

    toast.add({
      severity: 'info',
      summary: t('submission.changesSaved'),
      detail: t('actions.saveChangesLocally'),
      life: 4000
    })
  }

  // AI : Handle pending project updates
  async function handlePendingProjectUpdate() {
    const result = await trpc.project.getUsersContributions.query({ limit: 100 })
    const project = result.projects.find(p => p.id === options.entityId)
    
    if (!project) {
      throw new Error(t('errors.projectNotFound'))
    }
    
    const projectData = {
      id: options.entityId,
      name: formData.name,
      description: formData.description,
      cityId: project.cityId,
      lat: project.lat,
      lng: project.lng,
      proposalDate: formData.proposalDate,
      startDate: formData.startDate,
      endDate: formData.endDate,
      sourceUrl: formData.sourceUrl,
      latestUpdateOn: formData.latestUpdateOn,
    }

    await trpc.project.publishProject.mutate(buildProjectPayload(projectData))

    toast.add({
      severity: 'info',
      summary: t('moderation.projectUpdated'),
      detail: t('submission.changesSaved'),
      life: 3000
    })
  }

  // AI : Handle pending overlay updates
  async function handlePendingOverlayUpdate(changes: FieldChange[]) {
    const overlayData: OverlayUpdateData = { id: options.entityId }
    changes.forEach(change => {
      if (change.fieldName === 'caption') {
        overlayData.caption = change.newValue
      }
    })
    
    await trpc.overlay.updateOverlay.mutate(overlayData)
    
    toast.add({
      severity: 'info',
      summary: t('moderation.projectUpdated'),
      detail: t('submission.changesSaved'),
      life: 3000
    })
  }

  // AI : Handle pending entity updates (direct changes without change requests)
  async function handlePendingEntityUpdate(changes: FieldChange[]) {
    if (options.entityType === 'project') {
      await handlePendingProjectUpdate()
    } else if (options.entityType === 'overlay') {
      await handlePendingOverlayUpdate(changes)
    }
  }

  // AI : Handle approved entity updates (via change requests)
  async function handleApprovedEntityUpdate(changes: FieldChange[]) {
    await submitMultipleFieldChanges(options.entityType, options.entityId, changes)

    toast.add({
      severity: 'success',
      summary: t('submission.changeRequestSubmitted'),
      detail: t('submission.changeRequestSubmitted'),
      life: 3000
    })
  }

  // AI : Submit changes directly for pending entities or as change requests for approved entities
  async function submitChanges() {
    if (!hasChanges.value) return

    try {
      isSubmitting.value = true

      if (!validateProjectName()) return

      const changes = getChangesToSubmit();

      if (options.localOnly) {
        handleLocalOnlyUpdate()
      } else if (options.entityStatus === 'pending') {
        await handlePendingEntityUpdate(changes)
      } else {
        await handleApprovedEntityUpdate(changes)
      }

      options.onSubmitted?.()
      options.onClose?.()
    } catch (error) {
      console.error('Failed to submit changes:', error)
      toast.add({
        severity: 'error',
        summary: t('toast.submissionFailed'),
        detail: t('moderation.rejectionFailedDetail'),
        life: 3000
      })
    } finally {
      isSubmitting.value = false
    }
  }

  return {
    // State
    formData,
    originalData,
    changeReason,
    isSubmitting,
    
    // Computed
    hasChanges,
    
    // Methods
    hasChanged,
    resetChanges,
    getChangesToSubmit,
    formatValue,
    getFieldClasses,
    submitChanges
  }
}
