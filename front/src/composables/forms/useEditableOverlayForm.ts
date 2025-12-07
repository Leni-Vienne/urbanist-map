import { trpc } from '@/client'
import { useEditableFormBase } from './useEditableFormBase'
import { useToast } from '@/composables/ui/useToast'
import { t } from '@/locales'
import type { OverlayFormData, FieldChange } from '../../types/forms'
import type { ApprovalStatus } from '@shared/types'

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

  // AI : Create submit handler using base composable
  const submitChanges = base.createSubmitHandler(handlePendingOverlayUpdate)

  return {
    ...base,
    submitChanges
  }
}
