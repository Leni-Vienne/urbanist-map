import { buildProjectPayload } from '@/composables/project/useProjectMutations'
import { useProjectStore } from '@/stores/pinia/projectStore'
import { updateStandaloneProjectMarkerColor } from '@/composables/map/useCityMarkers'
import { trpc } from '@/client'
import { useEditableFormBase } from './useEditableFormBase'
import { useToast } from '@/composables/ui/useToast'
import { t } from '@/locales'
import { projectSchema, getValidationErrorsMap } from '@shared/validation/schemas'
import { prepareProjectValidationData } from '@/utils/validationHelpers'
import type { Project } from '@/types/index'
import type { ProjectFormData } from '../../types/forms'
import type { DBCity } from '../../../../back/src/db/schema'
import type { ApprovalStatus } from '@shared/types'

export interface EditableProjectFormOptions {
  entityId: string
  initialData: ProjectFormData
  entityStatus: ApprovalStatus | null
  localOnly?: boolean // AI : If true, only update local store, don't submit to backend
  getAvailableCities?: () => { id: string; name: string; countryCode: string; lat: number; lng: number; distance?: number }[] // AI : Function to get current cities dynamically
  onSubmitted?: () => void
  onClose?: () => void
}


// AI : Custom comparator for Date handling in project forms
  function projectComparator(original: any, current: any): boolean {
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

export function useEditableProjectForm(options: EditableProjectFormOptions) {
  const projectStore = useProjectStore()
  const toast = useToast()
  
  // AI : Use base composable for common form logic with custom Date comparator
  const base = useEditableFormBase<ProjectFormData>(
    {
      entityId: options.entityId,
      entityType: 'project',
      initialData: options.initialData,
      entityStatus: options.entityStatus,
      onSubmitted: options.onSubmitted,
      onClose: options.onClose
    },
    projectComparator
  )

  // AI : Update city object when cityId changes
  function getCityObjectForUpdate(currentProject: Project): DBCity {
    let cityObject: DBCity = currentProject.city

    if (base.formData.cityId && base.formData.cityId !== currentProject.cityId && options.getAvailableCities) {
      const citiesArray = options.getAvailableCities()
      const newCity = citiesArray.find(c => c.id === base.formData.cityId)
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
      name: base.formData.name,
      description: base.formData.description,
      proposalDate: base.formData.proposalDate,
      startDate: base.formData.startDate,
      endDate: base.formData.endDate,
      sourceUrl: base.formData.sourceUrl,
      latestUpdateOn: base.formData.latestUpdateOn,
      cityId: base.formData.cityId ?? undefined,
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
      name: base.formData.name,
      description: base.formData.description,
      cityId: project.cityId,
      lat: project.lat,
      lng: project.lng,
      proposalDate: base.formData.proposalDate,
      startDate: base.formData.startDate,
      endDate: base.formData.endDate,
      sourceUrl: base.formData.sourceUrl,
      latestUpdateOn: base.formData.latestUpdateOn,
    }

    await trpc.project.publishProject.mutate(buildProjectPayload(projectData))

    toast.add({
      severity: 'info',
      summary: t('moderation.projectUpdated'),
      detail: t('submission.changesSaved'),
      life: 3000
    })
  }

  // AI : Validate all form data using Zod schema
  function validateFormData(): boolean {
    // AI : Get current project for lat/lng
    const currentProject = projectStore.projects[options.entityId] ?? projectStore.allProjects[options.entityId]
    
    const validationData = prepareProjectValidationData(base.formData, {
      lat: currentProject?.lat,
      lng: currentProject?.lng
    })

    const result = projectSchema.safeParse(validationData)
    
    if (!result.success) {
      const errors = getValidationErrorsMap(result.error)
      const firstError = Object.values(errors)[0]
      toast.add({
        severity: 'error',
        summary: t('toast.validationError'),
        detail: t(firstError.key, firstError.params ?? {}),
        life: 3000
      })
      return false
    }

    return true
  }

  // AI : Submit changes with local-only handling and validation
  async function submitChanges() {
    if (!base.hasChanges.value) return

    try {
      base.isSubmitting.value = true

      if (!validateFormData()) return

      if (options.localOnly) {
        handleLocalOnlyUpdate()
      } else {
        const changes = base.getChangesToSubmit()

        if (options.entityStatus === 'pending') {
          await handlePendingProjectUpdate()
        } else {
          await base.handleApprovedEntityUpdate(changes)
        }
      }

      options.onSubmitted?.()
      options.onClose?.()
    } catch (error) {
      console.error('Failed to submit changes:', error)
      base.showErrorToast()
    } finally {
      base.isSubmitting.value = false
    }
  }

  return {
    ...base,
    submitChanges
  }
}
