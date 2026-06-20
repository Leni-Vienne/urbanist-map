import { watch } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";

/**
 * App-level tab navigation rules, set up once at the page level so they persist
 * regardless of which menu (desktop SideMenu or mobile MobileDrawer) is mounted.
 *
 * The active tab is the single source of truth: the map mode is derived from it in
 * mapStore, so these watchers only move the user off a tab they no longer belong on.
 */
export function useTabNavigation() {
  const authStore = useAuthStore();
  const uiStore = useUiStore();

  // Sign-out: leave the auth-only tabs (which also drops the map back to view mode).
  watch(
    () => authStore.isAuthenticated,
    (isAuthenticated) => {
      if (
        !isAuthenticated &&
        (uiStore.activeTab === "contribute" || uiStore.activeTab === "moderation")
      ) {
        uiStore.activeTab = "latest";
      }
    },
  );

  // Losing moderator rights: leave the moderation tab.
  watch(
    () => authStore.isModerator,
    (isModerator) => {
      if (!isModerator && uiStore.activeTab === "moderation") {
        uiStore.activeTab = "latest";
      }
    },
  );
}
