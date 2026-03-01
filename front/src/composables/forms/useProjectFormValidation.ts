import { t } from "@/locales";
import { useToast } from "@/composables/ui/useToast";
import type { ProjectFormData } from "@/types/index";
import { projectSchema, getValidationErrorsMap } from "@shared/validation/schemas";

// AI : Shared validation logic for project forms using Zod
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
    isProposed: boolean,
    cities: { id: number }[],
    citiesLoaded: boolean,
  ): boolean {
    // AI : City-related checks (not covered by Zod schema)
    // AI : cityId is a number, so check explicitly (0 is invalid but falsy)
    if (!formData.cityId || formData.cityId === 0 || !citiesLoaded) {
      showError(t("project.locationRequired"));
      return false;
    }

    if (cities.length > 0 && !cities.find((c) => c.id === formData.cityId)) {
      showError(t("project.locationRequired"));
      return false;
    }

    // AI : Validate with Zod schema (use dummy lat/lng for form-level validation)
    // AI : Transform null values to empty strings to match schema expectations
    const validationData = {
      ...formData,
      lat: 0,
      lng: 0,
      description: formData.description ?? "",
      sourceUrl: formData.sourceUrl ?? "",
    };
    const result = projectSchema.safeParse(validationData);

    if (!result.success) {
      // AI : Get first error and show it
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
