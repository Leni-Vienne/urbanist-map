import { trpc } from '@client'
import { useEditableFormBase } from './useEditableFormBase'
import { useToast } from '@composables/ui/useToast'
import { useI18n } from '@composables/useI18n'
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
  const toast = useToast()
  const { t } = useI18n()

  // AI : Use base composable for common form logic
  const base = useEditableFormBase<OverlayFormData>({
    entityId: options.entityId,
    entityType: 'overlay',
    initialData: options.initialData,
    entityStatus: options.entityStatus,
    onSubmitted: options.onSubmitted,
    onClose: options.onClose
  })

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

  // AI : Submit changes directly for pending entities or as change requests for approved entities
  async function submitChanges() {
    if (!base.hasChanges.value) return

    try {
      base.isSubmitting.value = true

      const changes = base.getChangesToSubmit()

      if (options.entityStatus === 'pending') {
        await handlePendingOverlayUpdate(changes)
      } else {
        await base.handleApprovedEntityUpdate(changes)
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
    // State
    formData: base.formData,
    originalData: base.originalData,
    changeReason: base.changeReason,
    isSubmitting: base.isSubmitting,

    // Computed
    hasChanges: base.hasChanges,

    // Methods
    hasChanged: base.hasChanged,
    resetChanges: base.resetChanges,
    getChangesToSubmit: base.getChangesToSubmit,
    formatValue: base.formatValue,
    getFieldClasses: base.getFieldClasses,
    submitChanges
  }
}
