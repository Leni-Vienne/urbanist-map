import { trpc } from "@/client";
import { useToast } from "@/composables/ui/useToast";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { createProjectObject } from "@/utils/typeFactories";
import { selectProject } from "@/services/map/projectSelection";
import { flyToGeometry } from "@/services/map/mapNavigation";
import { onMlMapReady, bootedFromDeeplinkView } from "@/services/core/map";

// Handle a /project/:slug deep link: a visitor arriving from Google or a pasted link lands directly
// in the live app focused on the project. Resolves the slug to a project (or a deletion tombstone),
// then flies the map and opens the detail panel once the map is ready.
//
// `slug` and `t` are passed in (not read via useRoute/useI18n here) because the caller invokes this
// after an await, by which point the active component instance is gone and those composables would
// return undefined. useToast is safe to call here (it only emits on an event bus).
export async function handleProjectDeepLink(
  slug: string | string[] | undefined,
  t: (key: string) => string,
): Promise<void> {
  const resolvedSlug = Array.isArray(slug) ? slug[0] : slug;
  if (typeof resolvedSlug !== "string" || resolvedSlug.length === 0) return;

  const toast = useToast();
  const projectStore = useProjectStore();

  let result: Awaited<ReturnType<typeof trpc.project.getBySlug.query>>;
  try {
    result = await trpc.project.getBySlug.query({ slug: resolvedSlug });
  } catch (error) {
    console.error("Failed to resolve project deep link:", error);
    return;
  }

  if (result.found) {
    const project = createProjectObject({
      ...result.project,
      tags: result.project.tags ?? [],
      overlayIds: [],
    });
    projectStore.updateProject(project.id, project);
    const { lat, lng } = project;
    // In production the map already booted centered on this project (the SEO shell injected its
    // coords), so set the final zoom instantly instead of flying in from the default view. On the
    // dev server, where no coords are injected, it falls back to the animated fly.
    const instant = bootedFromDeeplinkView.value;
    onMlMapReady(() => {
      if (lat != null && lng != null) {
        flyToGeometry([lat, lng], project.geometrySizeM ?? 0, { instant });
      }
      selectProject(project);
    });
    return;
  }

  // Project gone (tombstone): center on the last known location when recorded and tell the visitor.
  // An entirely unknown slug just leaves the visitor on the default map view.
  if (result.gone) {
    if (result.lat != null && result.lng != null) {
      const lat = result.lat;
      const lng = result.lng;
      onMlMapReady(() => {
        flyToGeometry([lat, lng], 0);
      });
    }
    toast.add({
      severity: "info",
      summary: t("project.deepLink.goneTitle"),
      detail: t("project.deepLink.goneDetail"),
      life: 6000,
    });
  }
}
