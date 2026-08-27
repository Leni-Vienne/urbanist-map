import { trpc } from "@/client";
import { t } from "@/locales";
import { loadOrNull } from "@/services/core/errorHandling";
import { useAuthStore } from "@/stores/authStore";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { useContributionStore } from "@/stores/contributionStore";
import { useProjectStore } from "@/stores/projectStore";
import { projectFromWire } from "@/utils/typeFactories";

let loadToken = 0;

async function loadUserContributions(force: boolean): Promise<void> {
  const authStore = useAuthStore();
  const changeRequestStore = useChangeRequestStore();
  const contributionStore = useContributionStore();
  const projectStore = useProjectStore();
  const userId = authStore.user?.id;
  if (!userId) return;
  if (
    !force &&
    (contributionStore.loading || (contributionStore.loaded && changeRequestStore.loaded))
  ) {
    return;
  }

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
      for (const project of Object.values(result.projectsById)) {
        projectStore.upsertProjectSummary(projectFromWire(project));
      }
      contributionStore.setData({
        projectIds: Object.keys(result.projectsById),
        overlaysById: result.overlaysById,
        projectOverlayIds: result.projectOverlayIds,
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

export async function fetchUserContributions(): Promise<void> {
  await loadUserContributions(false);
}

export async function refreshUserContributions(): Promise<void> {
  await loadUserContributions(true);
}
