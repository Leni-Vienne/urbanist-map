import { t } from "@/locales";
import { useToast } from "@/composables/ui/useToast";
import type { ProjectFormData } from "@/types/index";
import { getProjectValidationErrors } from "@/utils/validationHelpers";

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
    showError(t(firstError.key, firstError.params ?? {}));
    return false;
  }

  return { validateProjectForm };
}
