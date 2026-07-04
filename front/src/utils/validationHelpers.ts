import { projectSchema, getValidationErrorsMap } from "@shared/validation/schemas";
import { t } from "@/locales";
import { useToast } from "@/composables/ui/useToast";
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

// Validates the project form and toasts the first error. Returns true when valid.
export function validateProjectForm(
  formData: ProjectFormData,
  timelineStatus: "proposed" | "planned" | "under_construction" | "completed" | "canceled",
): boolean {
  // Scope dates to the selected timeline status, then run the shared prep + schema parse.
  const scopedFormData = {
    ...formData,
    timelineStatus,
    proposalDate: timelineStatus === "proposed" ? formData.proposalDate : null,
    proposalDatePrecision: timelineStatus === "proposed" ? formData.proposalDatePrecision : null,
    startDate: timelineStatus === "proposed" ? null : formData.startDate,
    startDatePrecision: timelineStatus === "proposed" ? null : formData.startDatePrecision,
    endDate: timelineStatus === "proposed" ? null : formData.endDate,
    endDatePrecision: timelineStatus === "proposed" ? null : formData.endDatePrecision,
  };

  const errors = getProjectValidationErrors(scopedFormData);
  if (!errors) return true;

  const firstError = Object.values(errors)[0];
  if (!firstError) {
    throw new Error("No error found");
  }
  useToast().add({
    severity: "error",
    summary: t("toast.validationError"),
    detail: t(firstError.key, firstError.params ?? {}),
    life: 3000,
  });
  return false;
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
