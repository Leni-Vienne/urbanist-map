import { trpc } from "@/client";

import { useProjectStore } from "@/stores/projectStore";
import { createProjectObject, getProjectDetailFields } from "@/utils/typeFactories";
import { openProjectDetail } from "@/services/map/projectSelection";
import { flyToGeometry } from "@/services/map/mapNavigation";
import { onMapReady, bootedFromDeeplinkView } from "@/services/core/map";

import { loadOrNull } from "@/services/core/errorHandling";
import { toastInfo } from "@/services/core/toast";

// Handle a /project/:slug deep link: a visitor arriving from Google or a pasted link lands directly
// in the live app focused on the project. Resolves the slug to a project (or a deletion tombstone),
// then flies the map and opens the detail panel once the map is ready.
//
// `slug` and `t` are passed in (not read via useRoute/useI18n here) because this runs after an
// await, with no active component instance, so those composables would return undefined.
export async function handleProjectDeepLink(
  slug: string | string[] | undefined,
  t: (key: string) => string,
): Promise<void> {
  const resolvedSlug = Array.isArray(slug) ? slug[0] : slug;
  if (typeof resolvedSlug !== "string" || resolvedSlug.length === 0) return;

  const projectStore = useProjectStore();

  const result = await loadOrNull(async () => trpc.project.getBySlug.query({ slug: resolvedSlug }));

  if (!result) return;

  if (result.found) {
    const project = createProjectObject({
      ...result.project,
      tags: result.project.tags ?? [],
      overlayIds: [],
    });
    projectStore.upsertProjectSummary(project);
    projectStore.applyProjectDetail(project.id, getProjectDetailFields(project));
    const { lat, lng } = project;
    // In production the map already booted centered on this project (the SEO shell injected its
    // coords), so set the final zoom instantly instead of flying in from the default view. On the
    // dev server, where no coords are injected, it falls back to the animated fly.
    const instant = bootedFromDeeplinkView.value;
    onMapReady(() => {
      if (typeof lat === "number" && typeof lng === "number") {
        flyToGeometry([lat, lng], project.geometrySizeM ?? 0, { instant });
      }
      openProjectDetail(project);
    });
    return;
  }

  // Project gone (tombstone): center on the last known location when recorded and tell the visitor.
  // An entirely unknown slug just leaves the visitor on the default map view.
  if (result.gone) {
    if (typeof result.lat === "number" && typeof result.lng === "number") {
      const lat = result.lat;
      const lng = result.lng;
      onMapReady(() => {
        flyToGeometry([lat, lng], 0);
      });
    }
    toastInfo(t("project.deepLink.goneDetail"), t("project.deepLink.goneTitle"));
  }
}
