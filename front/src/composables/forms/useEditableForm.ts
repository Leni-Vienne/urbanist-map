import { ref, computed, reactive } from 'vue'
import { useChangeRequests } from '@composables/changes/useChanges'
import { useToast } from '@composables/ui/useToast'
import { useI18n } from '@composables/useI18n'
import { buildProjectPayload } from '@composables/project/useProjectMutations'
import { useProjectStore } from '@stores/pinia/projectStore'
import { updateDevelopmentMarkerColor } from '@composables/map/useCityMarkers'
import { trpc } from '@client'
import { formatDate } from '@utils/dateFormat'

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
  entityStatus?: 'pending' | 'approved' | 'rejected' | 'replaced'
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
    const original = (originalData as T)[fieldName] as any
    const current = (formData as T)[fieldName] as any

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

    Object.keys(formData).forEach(key => {
      const fieldName = key as keyof T
      if (hasChanged(fieldName)) {
        changes.push({
          fieldName: String(fieldName),
          oldValue: (originalData as T)[fieldName],
          newValue: (formData as T)[fieldName],
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

  // AI : Submit changes directly for pending entities or as change requests for approved entities
  async function submitChanges() {
    if (!hasChanges.value) return

    try {
      isSubmitting.value = true

      // AI : Validate project name length if it's a project and name has changed
      if (options.entityType === 'project' && formData.name) {
        const trimmedName = String(formData.name).trim()
        if (trimmedName.length < 8) {
          toast.add({
            severity: 'error',
            summary: t('toast.validationError'),
            detail: t('project.nameTooShort'),
            life: 3000
          })
          return
        }
      }

      const changes = getChangesToSubmit();

      // AI : If localOnly mode, just update local store without backend submission
      if (options.localOnly) {
        if (options.entityType === 'project') {
          // AI : Get current project - try local store first, then allProjects (includes nearby/backend)
          let currentProject = projectStore.projects[options.entityId]
          if (!currentProject) {
            currentProject = projectStore.allProjects[options.entityId]
          }

          if (!currentProject) {
            console.error('[useEditableForm] PROJECT NOT FOUND AT ALL!')
          }

          // AI : Update city object if cityId changed and we have available cities data
          let cityObject = currentProject.city
          if (formData.cityId && formData.cityId !== currentProject.cityId && options.getAvailableCities) {
            // AI : Get current cities dynamically at save time
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

          // AI : Update project in local store only and mark as modified
          // AI : Merge form data with current project to preserve all fields (city, isDevelopment, etc.)
          const updatedData = {
            ...currentProject, // Preserve all existing fields
            ...formData as any, // Apply form changes (includes cityId if changed)
            city: cityObject, // Update city object if cityId changed
            isModified: true
          }
          projectStore.updateProject(options.entityId, updatedData)


          // AI : Get updated project from store and update marker color if it's a development project
          const updatedProject = projectStore.projects[options.entityId]
          if (updatedProject?.isDevelopment) {
            updateDevelopmentMarkerColor(options.entityId, updatedProject)
          }

          toast.add({
            severity: 'info',
            summary: t('submission.changesSaved'),
            detail: t('actions.saveChangesLocally'),
            life: 4000
          })
        }

        options.onSubmitted?.()
        options.onClose?.()
        return
      }

      // AI : For pending entities, apply changes directly instead of creating change requests
      if (options.entityStatus === 'pending') {
        if (options.entityType === 'project') {
          const result = await trpc.project.getUsersContributions.query({ limit: 100 })
          const project = result.projects.find(p => p.id === options.entityId)
          
          if (!project) {
            throw new Error(t('errors.projectNotFound'))
          }
          
          // AI : Merge form data with current project data, preserving all fields
          const projectData = {
            id: options.entityId,
            name: formData.name,
            description: formData.description,
            cityId: project.cityId, // AI : Preserve existing cityId
            isDevelopment: project.isDevelopment,
            lat: project.lat,
            lng: project.lng,
            proposalDate: formData.proposalDate,
            startDate: formData.startDate,
            endDate: formData.endDate,
            sourceUrl: formData.sourceUrl,
            latestUpdateOn: formData.latestUpdateOn,
          }

          // AI : Use shared helper to build consistent payload
          await trpc.project.publishProject.mutate(buildProjectPayload(projectData))

          toast.add({
            severity: 'info',
            summary: t('moderation.projectUpdated'),
            detail: t('submission.changesSaved'),
            life: 3000
          })
        } else if (options.entityType === 'overlay') {
          // AI : Apply changes directly to pending overlay using updateOverlay
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
      } else {
        // AI : For approved entities, submit change requests for moderation
        await submitMultipleFieldChanges(options.entityType, options.entityId, changes)

        toast.add({
          severity: 'success',
          summary: t('submission.changeRequestSubmitted'),
          detail: t('submission.changeRequestSubmitted'),
          life: 3000
        })
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
