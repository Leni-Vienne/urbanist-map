import { projectSchema, getValidationErrorsMap } from "@shared/validation/schemas";
import type { ProjectFormData } from "@/types/index";

const DUMMY_UUID = "00000000-0000-0000-0000-000000000000";

export function prepareProjectValidationData(
  formData: Omit<ProjectFormData, "name"> & { name: string | null },
  options?: { lat?: number | null; lng?: number | null },
) {
  return {
    ...formData,
    name: formData.name ?? "",
    description: formData.description ?? undefined,
    sourceUrl: formData.sourceUrl ?? undefined,
    lat: options?.lat ?? 0,
    lng: options?.lng ?? 0,
  } as const;
}

// Returns the validation errors map for a project, or null when valid.
export function getProjectValidationErrors(
  formData: Parameters<typeof prepareProjectValidationData>[0],
  options?: Parameters<typeof prepareProjectValidationData>[1],
) {
  const result = projectSchema.safeParse(prepareProjectValidationData(formData, options));
  return result.success ? null : getValidationErrorsMap(result.error);
}

// Validates a project form against the selected timeline status: a proposed project carries only a
// proposal date, any other status carries only start/end dates. Returns the errors map, or null
// when valid.
export function getScopedProjectValidationErrors(
  formData: ProjectFormData,
  timelineStatus: ProjectFormData["timelineStatus"],
) {
  const isProposed = timelineStatus === "proposed";
  return getProjectValidationErrors({
    ...formData,
    timelineStatus,
    proposalDate: isProposed ? formData.proposalDate : null,
    proposalDatePrecision: isProposed ? formData.proposalDatePrecision : null,
    startDate: isProposed ? null : formData.startDate,
    startDatePrecision: isProposed ? null : formData.startDatePrecision,
    endDate: isProposed ? null : formData.endDate,
    endDatePrecision: isProposed ? null : formData.endDatePrecision,
  });
}

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
