import { useI18n } from "vue-i18n";
import { useNewProject } from "@/composables/overlay/useNewProject";
import { useToast } from "@/composables/ui/useToast";

/**
 * AI : Composable for handling "Add Overlay" button click
 * AI : Shared logic across CurrentCityPanel, MyContributionsPanel, and LatestContributionsPanel
 */
export function useAddOverlay() {
  const { t } = useI18n();
  const toast = useToast();
  const { handleNewProjectClick } = useNewProject();

  async function handleAddOverlayClick() {
    const result = await handleNewProjectClick();

    if (!result.success && result.reason === "edit_mode_error") {
      toast.add({
        severity: "error",
        summary: t("moderation.modeSwitchError"),
        detail: t("moderation.modeSwitchErrorDetail"),
        life: 3000,
      });
    }
    // AI : Auth modal is already opened by useNewProject for not_authenticated
    // AI : No toast for success - dialog opening is self-explanatory
  }

  return { handleAddOverlayClick };
}
