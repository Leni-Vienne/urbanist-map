// AI : Shared validation helper utilities
import type { ProjectFormData } from '../types/forms'

// AI : Dummy UUID for validation when actual value is not available
const DUMMY_UUID = '00000000-0000-0000-0000-000000000000'

/**
 * AI : Prepare project form data for validation by filling in required fields
 * with dummy values when they're not available (for field-level validation)
 */
export function prepareProjectValidationData(
  formData: ProjectFormData,
  options?: { lat?: number | null; lng?: number | null; cityId?: string }
) {
  return {
    ...formData,
    description: formData.description ?? undefined,
    sourceUrl: formData.sourceUrl ?? undefined,
    lat: options?.lat ?? 0,
    lng: options?.lng ?? 0,
    cityId: formData.cityId ?? options?.cityId ?? DUMMY_UUID
  } as const
}

/**
 * AI : Prepare overlay validation data with required fields
 */
export function prepareOverlayValidationData(overlay: {
  id: string
  filename?: string | null
  caption?: string | null
  projectId?: string | null
  corners?: Array<{ lat: number; lng: number }> | null
}) {
  return {
    id: overlay.id,
    filename: overlay.filename ?? 'temp.png',
    caption: overlay.caption ?? undefined,
    projectId: overlay.projectId ?? DUMMY_UUID,
    corners: overlay.corners || [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0 }
    ]
  }
}
