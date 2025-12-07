import { ref, computed, reactive } from 'vue'
import { useChangeRequests } from '@/composables/changes/useChanges'
import { useToast } from '@/composables/ui/useToast'
import { t } from '@/locales'
import { formatDate } from '@/utils/dateFormat'
import type { FieldChange } from '../../types/forms'
import type { ApprovalStatus } from '@shared/types'

// AI : Generic base options interface for editable forms
export interface EditableFormBaseOptions<TFormData> {
  entityId: string
  entityType: 'project' | 'overlay'
  initialData: TFormData
  entityStatus?: ApprovalStatus | null
  onSubmitted?: () => void
  onClose?: () => void
}

// AI : Custom comparator function type for field comparison
export type FieldComparator<TFormData> = (
  fieldName: keyof TFormData,
  original: any,
  current: any
) => boolean

// AI : Base composable for editable form state and common operations
export function useEditableFormBase<TFormData extends Record<string, any>>(
  options: EditableFormBaseOptions<TFormData>,
  customComparator?: FieldComparator<TFormData>
) {
  const { submitMultipleFieldChanges } = useChangeRequests()
  const toast = useToast()
  
  const isSubmitting = ref(false)
  const changeReason = ref('')

  // AI : Create reactive objects for original and current data
  const originalData = reactive({ ...options.initialData }) as TFormData
  const formData = reactive({ ...options.initialData }) as TFormData

  // AI : Check if a specific field has changed
  function hasChanged(fieldName: keyof TFormData): boolean {
    const original = originalData[fieldName]
    const current = formData[fieldName]

    // AI : Use custom comparator if provided (for Date handling, etc.)
    if (customComparator) {
      return customComparator(fieldName, original, current)
    }

    // AI : Default comparison
    return original !== current
  }

  // AI : Check if any field has changed
  const hasChanges = computed(() => {
    return Object.keys(formData).some(key => hasChanged(key as keyof TFormData))
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
      const fieldName = key as keyof TFormData
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
  function getFieldClasses(fieldName: keyof TFormData) {
    return {
      'field-changed': hasChanged(fieldName)
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

  // AI : Show error toast
  function showErrorToast() {
    toast.add({
      severity: 'error',
      summary: t('toast.submissionFailed'),
      detail: t('moderation.rejectionFailedDetail'),
      life: 3000
    })
  }

  // AI : Generic submit handler that can be extended by specific forms
  async function createSubmitHandler(
    handlePendingUpdate: (changes: FieldChange[]) => Promise<void>,
    validateFn?: () => boolean
  ) {
    return async () => {
      if (!hasChanges.value) return

      try {
        isSubmitting.value = true

        if (validateFn && !validateFn()) return

        const changes = getChangesToSubmit()

        if (options.entityStatus === 'pending') {
          await handlePendingUpdate(changes)
        } else {
          await handleApprovedEntityUpdate(changes)
        }

        options.onSubmitted?.()
        options.onClose?.()
      } catch (error) {
        console.error('Failed to submit changes:', error)
        showErrorToast()
      } finally {
        isSubmitting.value = false
      }
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
    handleApprovedEntityUpdate,
    showErrorToast,
    createSubmitHandler
  }
}
