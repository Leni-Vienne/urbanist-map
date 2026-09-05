import { trpc } from "@/client";
import { t } from "@/locales";
import { loadOrNull } from "@/services/core/errorHandling";
import { useAuthStore } from "@/stores/authStore";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { useContributionStore } from "@/stores/contributionStore";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { applyMapSessionRows } from "@/services/map/viewportTriggers";
import { overlayWireToData, projectFromWire } from "@/utils/typeFactories";

let loadToken = 0;

export async function refreshUserContributions(
  replaceOverlayIds?: ReadonlySet<string>,
): Promise<void> {
  const authStore = useAuthStore();
  const changeRequestStore = useChangeRequestStore();
  const contributionStore = useContributionStore();
  const projectStore = useProjectStore();
  const userId = authStore.user?.id;
  if (!userId) return;

  loadToken += 1;
  const token = loadToken;
  const epoch = authStore.getSessionEpoch();
  contributionStore.setLoading(true);
  try {
    const result = await loadOrNull(async () => trpc.project.getUsersContributions.query(), {
      errorMessage: t("contribute.loadContributionsError"),
    });
    if (
      result &&
      token === loadToken &&
      epoch === authStore.getSessionEpoch() &&
      authStore.user?.id === userId
    ) {
      if (useUiStore().mode === "edit") {
        applyMapSessionRows(
          "edit",
          result.editSession.projects,
          result.editSession.overlays.map(overlayWireToData),
          replaceOverlayIds,
        );
      }
      for (const project of Object.values(result.projectsById)) {
        projectStore.upsertProjectSummary(projectFromWire(project));
      }
      contributionStore.setData({
        projectIds: Object.keys(result.projectsById),
        overlaysById: result.overlaysById,
      });
      changeRequestStore.setPendingChangeRequests(result.changeRequests);
    }
  } finally {
    if (
      token === loadToken &&
      epoch === authStore.getSessionEpoch() &&
      authStore.user?.id === userId
    ) {
      contributionStore.setLoading(false);
    }
  }
}
