import { ref, computed, reactive } from 'vue'
import { useFieldChanges } from '@composables/changes/useFieldChanges'
import { useToast } from '@composables/ui/useToast'

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
  onSubmitted?: () => void
  onClose?: () => void
}

export function useEditableForm<T extends Record<string, any>>(options: EditableFormOptions<T>) {
  const { submitMultipleFieldChanges } = useFieldChanges()
  const toast = useToast()

  const isSubmitting = ref(false)
  const changeReason = ref('')
  
  // AI : Create reactive objects for original and current data
  const originalData = reactive({ ...options.initialData } as T)
  const formData = reactive({ ...options.initialData } as T)

  // AI : Check if a specific field has changed
  function hasChanged(fieldName: keyof T): boolean {
    const original = (originalData as any)[fieldName]
    const current = (formData as any)[fieldName]
    
    // AI : Handle Date objects comparison
    if (original instanceof Date && current instanceof Date) {
      return original.getTime() !== current.getTime()
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
          oldValue: (originalData as any)[fieldName],
          newValue: (formData as any)[fieldName],
          changeReason: changeReason.value || undefined
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

  // AI : Submit changes for moderation
  async function submitChanges() {
    if (!hasChanges.value) return

    try {
      isSubmitting.value = true

      const changes = getChangesToSubmit()

      await submitMultipleFieldChanges(options.entityType, options.entityId, changes)

      toast.add({
        severity: 'success',
        summary: 'Changes Submitted',
        detail: `${changes.length} change(s) submitted for moderation review`,
        life: 3000
      })

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