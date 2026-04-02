import { t } from "@/locales";
import { useToast } from "@/composables/ui/useToast";
import type { ProjectFormData } from "@/types/index";
import { projectSchema, getValidationErrorsMap } from "@shared/validation/schemas";

// Shared validation logic for project forms using Zod
export function useProjectFormValidation() {
  const toast = useToast();

  function showError(detail: string) {
    toast.add({
      severity: "error",
      summary: t("toast.validationError"),
      detail,
      life: 3000,
    });
  }

  function validateProjectForm(
    formData: ProjectFormData,
    timelineStatus: "proposed" | "planned" | "under_construction" | "completed" | "canceled",
    cities: { id: number }[],
    citiesLoaded: boolean,
  ): boolean {
    // We optionally have cityId, but if a city is provided it must exist
    if (formData.cityId && citiesLoaded && !cities.some((c) => c.id === formData.cityId)) {
      showError(t("project.invalidLocation"));
      return false;
    }

    // Validate with Zod schema (use dummy lat/lng for form-level validation)
    // Transform null values to empty strings to match schema expectations
    const validationData = {
      ...formData,
      lat: 0,
      lng: 0,
      description: formData.description ?? "",
      sourceUrl: formData.sourceUrl ?? "",
      timelineStatus,
      proposalDate: timelineStatus === "proposed" ? formData.proposalDate : null,
      proposalDatePrecision: timelineStatus === "proposed" ? formData.proposalDatePrecision : null,
      startDate: timelineStatus === "proposed" ? null : formData.startDate,
      startDatePrecision: timelineStatus === "proposed" ? null : formData.startDatePrecision,
      endDate: timelineStatus === "proposed" ? null : formData.endDate,
      endDatePrecision: timelineStatus === "proposed" ? null : formData.endDatePrecision,
    };
    const result = projectSchema.safeParse(validationData);

    if (!result.success) {
      // Get first error and show it
      const errors = getValidationErrorsMap(result.error);
      const firstError = Object.values(errors)[0];
      if (!firstError) {
        throw new Error("No error found");
      }
      showError(t(firstError.key, firstError.params ?? {}));
      return false;
    }

    return true;
  }

  return { validateProjectForm };
}
