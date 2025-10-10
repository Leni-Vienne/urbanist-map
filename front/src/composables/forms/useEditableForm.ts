import { ref, computed, reactive } from 'vue'
import { useFieldChanges } from '@composables/changes/useFieldChanges'
import { useToast } from '@composables/ui/useToast'
import { buildProjectPayload } from '@composables/project/useProjectMutations'
import { trpc } from '@client'

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
  entityStatus?: 'pending' | 'approved' | 'rejected'
  onSubmitted?: () => void
  onClose?: () => void
}

export function useEditableForm<T extends Record<string, any>>(options: EditableFormOptions<T>) {
  const { submitMultipleFieldChanges } = useFieldChanges()
  const toast = useToast()

  const isSubmitting = ref(false)
  const changeReason = ref('')
  
  // AI : Create reactive objects for original and current data
  const originalData = reactive({ ...options.initialData })
  const formData = reactive({ ...options.initialData })

  // AI : Check if a specific field has changed
  function hasChanged(fieldName: keyof T): boolean {
    const original = (originalData as T)[fieldName]
    const current = (formData as T)[fieldName]
    
    // AI : Handle Date objects comparison
    if (original && typeof original === 'object' && 'getTime' in original && current && typeof current === 'object' && 'getTime' in current) {
      return (original as Date).getTime() !== (current as Date).getTime()
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
      return value.toLocaleDateString()
    }
    if (typeof value === 'number') {
      return value.toFixed(6)
    }
    return String(value)
  }

  // AI : Format date specifically for display
  function formatDate(date: Date | null | undefined): string {
    if (!date) return ''
    return date.toLocaleDateString()
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

      const changes = getChangesToSubmit()

      // AI : For pending entities, apply changes directly instead of creating change requests
      if (options.entityStatus === 'pending') {
        if (options.entityType === 'project') {
          // AI : Fetch current project data to avoid losing fields not in the form
          const currentProject = await trpc.project.getUsersContributions.query({ limit: 100 })
          const project = currentProject.find(p => p.id === options.entityId)
          
          if (!project) {
            throw new Error('Project not found')
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
            severity: 'success',
            summary: 'Project Updated',
            detail: `Project changes saved successfully`,
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
            severity: 'success',
            summary: 'Overlay Updated',
            detail: `Overlay changes saved successfully`,
            life: 3000
          })
        }
      } else {
        // AI : For approved entities, submit change requests for moderation
        await submitMultipleFieldChanges(options.entityType, options.entityId, changes)

        toast.add({
          severity: 'success',
          summary: 'Changes Submitted',
          detail: `${changes.length} change(s) submitted for moderation review`,
          life: 3000
        })
      }

      options.onSubmitted?.()
      options.onClose?.()
    } catch (error) {
      console.error('Failed to submit changes:', error)
      toast.add({
        severity: 'error',
        summary: 'Submission Failed',
        detail: 'Failed to submit changes. Please try again.',
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
    formatDate,
    getFieldClasses,
    submitChanges
  }
}
