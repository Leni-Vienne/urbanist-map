// Shared validation helper utilities
import type { ProjectFormData } from "@/types/index";

// Dummy UUID for validation when actual value is not available (for project/overlay IDs)
const DUMMY_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Prepare project form data for validation by filling in required fields
 * with dummy values when they're not available (for field-level validation)
 */
export function prepareProjectValidationData(
  formData: Omit<ProjectFormData, "name"> & { name: string | null },
  options?: { lat?: number | null; lng?: number | null; cityId?: number },
) {
  return {
    ...formData,
    name: formData.name ?? "",
    description: formData.description ?? undefined,
    sourceUrl: formData.sourceUrl ?? undefined,
    countryCode: formData.countryCode ?? "",
    lat: options?.lat ?? 0,
    lng: options?.lng ?? 0,
    cityId: formData.cityId ?? options?.cityId ?? null,
  } as const;
}

/**
 * Prepare overlay validation data with required fields
 */
export function prepareOverlayValidationData(overlay: {
  id: string;
  filename?: string | null;
  caption?: string | null;
  projectId?: string | null;
  corners?: { lat: number; lng: number }[] | null;
}) {
  return {
    id: overlay.id,
    filename: overlay.filename ?? "temp.png",
    caption: overlay.caption ?? undefined,
    projectId: overlay.projectId ?? DUMMY_UUID,
    corners: overlay.corners ?? [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0 },
    ],
  };
}
