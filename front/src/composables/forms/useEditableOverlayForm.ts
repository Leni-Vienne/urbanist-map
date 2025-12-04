import { ref, computed, reactive } from 'vue'
import { useChangeRequests } from '@composables/changes/useChanges'
import { useToast } from '@composables/ui/useToast'
import { useI18n } from '@composables/useI18n'
import { trpc } from '@client'
import { formatDate } from '@utils/dateFormat'
import type { OverlayFormData, FieldChange } from '../../types/forms'
import type { ApprovalStatus } from '../../../../back/src/shared/types'

// AI : Overlay update payload based on updateOverlaySchema
interface OverlayUpdateData {
  id: string
  caption?: string
}

export interface EditableOverlayFormOptions {
  entityId: string
  initialData: OverlayFormData
  entityStatus?: ApprovalStatus | null
  onSubmitted?: () => void
  onClose?: () => void
}

export function useEditableOverlayForm(options: EditableOverlayFormOptions) {
  const { submitMultipleFieldChanges } = useChangeRequests()
  const toast = useToast()
  const { t } = useI18n()

  const isSubmitting = ref(false)
  const changeReason = ref('')

  // AI : Create reactive objects for original and current data
  // AI : Type is inferred from the object, no explicit generic needed
  const originalData = reactive({ ...options.initialData })
  const formData = reactive({ ...options.initialData })

  // AI : Check if a specific field has changed
  function hasChanged(fieldName: keyof OverlayFormData): boolean {
    // AI : Access reactive values directly (not with toRaw) to maintain reactivity tracking
    const original = originalData[fieldName]
    const current = formData[fieldName]

    return original !== current
  }

  // AI : Check if any field has changed
  const hasChanges = computed(() => {
    return Object.keys(formData).some(key => hasChanged(key as keyof OverlayFormData))
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
      const fieldName = key as keyof OverlayFormData
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
  function getFieldClasses(fieldName: keyof OverlayFormData) {
    return {
      'field-changed': hasChanged(fieldName)
    }
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

  // AI : Handle approved entity updates (via change requests)
  async function handleApprovedEntityUpdate(changes: FieldChange[]) {
    await submitMultipleFieldChanges('overlay', options.entityId, changes)

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

      const changes = getChangesToSubmit();

      if (options.entityStatus === 'pending') {
        await handlePendingOverlayUpdate(changes)
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
