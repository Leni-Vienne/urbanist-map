import { ref, computed, reactive } from 'vue'
import { useChangeRequests } from '@composables/changes/useChanges'
import { useToast } from '@composables/ui/useToast'
import { useI18n } from '@composables/useI18n'
import { buildProjectPayload } from '@composables/project/useProjectMutations'
import { useProjectStore } from '@stores/pinia/projectStore'
import { updateStandaloneProjectMarkerColor } from '@composables/map/useCityMarkers'
import { trpc } from '@client'
import { formatDate } from '@utils/dateFormat'
import type { Project } from '@types'
import type { ProjectFormData, FieldChange } from '../../types/forms'
import type { DBCity } from '../../../../back/src/shared/schema'
import { ApprovalStatus } from '../../../../back/src/shared/types'

export interface EditableProjectFormOptions {
  entityId: string
  initialData: ProjectFormData
  entityStatus: ApprovalStatus | null
  localOnly?: boolean // AI : If true, only update local store, don't submit to backend
  getAvailableCities?: () => Array<{ id: string; name: string; countryCode: string; lat: number; lng: number; distance?: number }> // AI : Function to get current cities dynamically
  onSubmitted?: () => void
  onClose?: () => void
}

export function useEditableProjectForm(options: EditableProjectFormOptions) {
  const { submitMultipleFieldChanges } = useChangeRequests()
  const toast = useToast()
  const { t } = useI18n()
  const projectStore = useProjectStore()

  const isSubmitting = ref(false)
  const changeReason = ref('')

  // AI : Create reactive objects for original and current data
  // AI : Type is inferred from the object, no explicit generic needed
  const originalData = reactive({ ...options.initialData })
  const formData = reactive({ ...options.initialData })

  // AI : Check if a specific field has changed
  function hasChanged(fieldName: keyof ProjectFormData): boolean {
    // AI : Access reactive values directly (not with toRaw) to maintain reactivity tracking
    const original = originalData[fieldName]
    const current = formData[fieldName]

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
    return Object.keys(formData).some(key => hasChanged(key as keyof ProjectFormData))
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
      const fieldName = key as keyof ProjectFormData
      if (hasChanged(fieldName)) {
        changes.push({
          fieldName: String(fieldName),
          oldValue: originalData[fieldName],
          newValue: formData[fieldName],
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
  function getFieldClasses(fieldName: keyof ProjectFormData) {
    return {
      'field-changed': hasChanged(fieldName)
    }
  }

  // AI : Validate project name meets minimum length requirement
  function validateProjectName(): boolean {
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
    let currentProject = projectStore.projects[options.entityId] ?? projectStore.allProjects[options.entityId]

    if (!currentProject) {
      console.error('[useEditableProjectForm] PROJECT NOT FOUND AT ALL!')
      return
    }

    const cityObject = getCityObjectForUpdate(currentProject)
    const updatedData: Partial<Project> = {
      ...currentProject,
      name: formData.name,
      description: formData.description,
      proposalDate: formData.proposalDate,
      startDate: formData.startDate,
      endDate: formData.endDate,
      sourceUrl: formData.sourceUrl,
      latestUpdateOn: formData.latestUpdateOn,
      cityId: formData.cityId ?? undefined,
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

  // AI : Handle approved entity updates (via change requests)
  async function handleApprovedEntityUpdate(changes: FieldChange[]) {
    await submitMultipleFieldChanges('project', options.entityId, changes)

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
        await handlePendingProjectUpdate()
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
