import { trpc } from "@/client";
import { t } from "@/locales";
import { loadOrNull } from "@/services/core/errorHandling";
import { useAuthStore } from "@/stores/authStore";
import { useProjectStore } from "@/stores/projectStore";

let loadToken = 0;

async function loadUserContributions(force: boolean): Promise<void> {
  const authStore = useAuthStore();
  const projectStore = useProjectStore();
  const userId = authStore.user?.id;
  if (!userId) return;
  if (!force && (projectStore.userContributionsLoaded || projectStore.userContributionsLoading)) {
    return;
  }

  loadToken += 1;
  const token = loadToken;
  const epoch = authStore.getSessionEpoch();
  projectStore.setUserContributionsLoading(true);
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
      projectStore.setUserContributions(result.projects);
    }
  } finally {
    if (
      token === loadToken &&
      epoch === authStore.getSessionEpoch() &&
      authStore.user?.id === userId
    ) {
      projectStore.setUserContributionsLoading(false);
    }
  }
}

export async function fetchUserContributions(): Promise<void> {
  await loadUserContributions(false);
}

export async function refreshUserContributions(): Promise<void> {
  await loadUserContributions(true);
}
