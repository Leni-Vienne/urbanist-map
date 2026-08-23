import { trpc } from "@/client";

import { useProjectStore } from "@/stores/projectStore";
import { hydratedProjectFromWire } from "@/utils/typeFactories";
import { openProjectDetail } from "@/services/core/projectSelection";
import { nextTick } from "vue";
import {
  flyToGeometry,
  mobileAwareFlyToBounds,
  MOBILE_CONTENT_TOP_INSET,
} from "@/services/core/mapNavigation";
import { buildShapeBounds } from "@/utils/cornersBounds";
import { onMapReady, bootedFromDeeplinkView, DEEPLINK_FIT_MAX_ZOOM } from "@/services/core/map";

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
    const project = hydratedProjectFromWire(result.project);
    projectStore.upsertHydratedProject(project);
    const { lat, lng } = project;
    // In production the map already booted framed on this project (the SEO shell injected its
    // bounds), so set the final camera instantly instead of flying in from the default view. On the
    // dev server, where nothing is injected, it falls back to the animated move.
    const instant = bootedFromDeeplinkView.value;
    const camera = { mobileTopInset: MOBILE_CONTENT_TOP_INSET, instant };
    const shapeBounds = buildShapeBounds(project.geometry);
    onMapReady(() => {
      function frameProject(): void {
        if (shapeBounds) {
          mobileAwareFlyToBounds(shapeBounds, { maxZoom: DEEPLINK_FIT_MAX_ZOOM, ...camera });
        } else if (typeof lat === "number" && typeof lng === "number") {
          flyToGeometry([lat, lng], project.geometrySizeM ?? 0, camera);
        }
      }

      openProjectDetail(project);
      // Frame only once the detail is rendered: on mobile the bottom inset is measured off the
      // drawer, and estimating it while the drawer is absent leaves the project under it.
      void nextTick(frameProject);
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
