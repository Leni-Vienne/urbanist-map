import { LngLat } from "maplibre-gl";
import { t } from "@/locales";
import { mobileAwareFlyTo, mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import { useOverlayStore } from "@/stores/overlayStore";
import { useFocusStore } from "@/stores/focusStore";
import { useProjectStore } from "@/stores/projectStore";
import { useAuthStore } from "@/stores/authStore";
import type { LatLng, OverlayObject, Project } from "@/types/index";
import { trpc, getApiUrl } from "@/client";
import { projectSchema } from "@shared/validation/schemas";
import { MAX_UPLOAD_FILE_SIZE_BYTES, MAX_UPLOAD_FILE_SIZE_MB } from "@shared/uploadLimits";
import { isValidQuad } from "@/services/overlay/transform";

import { selectOverlay, raiseSelectedOverlayWhenReady } from "@/services/overlay/selection";
import { getMarker } from "@/services/overlay/mapLayers";
import { getOverlayBounds } from "@/services/overlay/markers";
import { buildLngLatBounds } from "@/utils/cornersBounds";
import { overlayWireToData } from "@/utils/typeFactories";
import { toastInfo } from "@/services/core/toast";

// Helper to zoom to overlay bounds
function zoomToOverlayBounds(overlay: OverlayObject): void {
  // Try to get bounds from overlay data (works whether the image layer exists or not)
  const overlayBounds = getOverlayBounds(overlay);
  if (overlayBounds) {
    mobileAwareFlyToBounds(overlayBounds);
    return;
  }

  // Fall back to marker position if bounds unavailable
  const marker = getMarker(overlay.id);
  if (marker) {
    const lngLat = marker.getLngLat();
    mobileAwareFlyTo(new LngLat(lngLat.lng, lngLat.lat), 17);
  }
}

/**
 * Sibling overlay ids of a project, derived from already-loaded overlays (not
 * project.overlayIds, which is only populated on detail open and can list overlays
 * that aren't loaded, hence not selectable). Shared by the toolbar index display and
 * prev/next navigation so both agree on order and count.
 */
export function getProjectSiblingOverlayIds(projectId: string): string[] {
  const overlayStore = useOverlayStore();
  return Object.values(overlayStore.liveOverlays)
    .filter((overlay) => overlay.projectId === projectId)
    .map((overlay) => overlay.id);
}

/**
 * Navigates between overlays in the current project based on direction.
 */

export function navigateOverlaySequence(direction: "next" | "previous") {
  const overlayStore = useOverlayStore();
  const selectedOverlayId = useFocusStore().selectedOverlayId;

  // Only callable from the floating toolbar, which requires a selected overlay.
  if (!selectedOverlayId) {
    return;
  }

  const currentOverlay = overlayStore.liveOverlays[selectedOverlayId];

  if (!currentOverlay?.projectId) {
    return;
  }

  const projectOverlayIds = getProjectSiblingOverlayIds(currentOverlay.projectId);

  if (projectOverlayIds.length <= 1) {
    toastInfo(t("overlay.onlyOneOverlayInProject"));
    return;
  }

  // Get the next/previous overlay (with wraparound)
  const currentIndex = projectOverlayIds.indexOf(selectedOverlayId);
  const step = direction === "next" ? 1 : -1;
  const newIndex = (currentIndex + step + projectOverlayIds.length) % projectOverlayIds.length;
  // newIndex is always in range: modulo over projectOverlayIds, which has length > 1 here.
  // oxlint-disable-next-line no-non-null-assertion
  const newOverlayId = projectOverlayIds[newIndex]!;

  selectAndCenterOverlay(newOverlayId);
}

/**
 * Loads an overlay by ID, fetching from backend if needed. Throws on fetch failure.
 */
type LoadOverlayResult = {
  alreadyInStore: boolean;
  corners?: { lat: number; lng: number }[];
};

async function loadOverlay(
  overlayId: string,
  includeIntersecting: boolean,
): Promise<LoadOverlayResult> {
  const overlayStore = useOverlayStore();

  if (overlayStore.liveOverlays[overlayId]) {
    return { alreadyInStore: true };
  }

  const result = await trpc.overlay.getOverlay.query({
    id: overlayId,
    includeIntersecting,
  });

  if (!result.overlay) {
    throw new Error("Overlay not found");
  }

  // Lazy-loaded as its own chunk: overlayRendering is dynamically imported here and in
  // vectorTileSync / viewportRenderLoop. A static import would merge it into this chunk and
  // defeat that split (INEFFECTIVE_DYNAMIC_IMPORT).
  const { renderViewModeOverlays } = await import("@/services/overlay/rendering");

  renderViewModeOverlays([overlayWireToData(result.overlay)], true);

  if (includeIntersecting && result.intersectingOverlays.length > 0) {
    renderViewModeOverlays(result.intersectingOverlays.map(overlayWireToData), true);
  }

  // Don't check overlayStore.liveOverlays[overlayId] here: overlay registration is async
  // (happens after image loads) and may not complete if zoom level is too low.
  // Return corners so the caller can fly to the overlay immediately.
  return { alreadyInStore: false, corners: result.overlay.corners };
}

/**
 * Navigates to a specific overlay by ID (loads + selects + centers).
 */
export async function navigateToOverlay(
  overlayId: string,
  includeIntersecting: boolean,
): Promise<boolean> {
  const loadResult = await loadOverlay(overlayId, includeIntersecting);

  if (loadResult.alreadyInStore) {
    return selectAndCenterOverlay(overlayId);
  }

  // Overlay was just fetched -- registration is async (happens after image loads).
  // Select now if it registered in time, otherwise fly directly to the backend corners.
  if (selectAndCenterOverlay(overlayId)) {
    return true;
  }
  if (loadResult.corners && loadResult.corners.length >= 4) {
    mobileAwareFlyToBounds(buildLngLatBounds(loadResult.corners));
    return true;
  }
  return false;
}

function selectAndCenterOverlay(overlayId: string) {
  const overlayStore = useOverlayStore();

  const overlay = overlayStore.liveOverlays[overlayId];

  if (!overlay) {
    return false;
  }

  selectOverlay(overlayId);
  zoomToOverlayBounds(overlay);
  // When selecting from the side panel while zoomed out, the image layer isn't rendered yet, so
  // the raise from selectOverlay no-ops. Re-raise once the flight renders it.
  raiseSelectedOverlayWhenReady(overlayId);

  return true;
}

export function updateOverlayInfo(id: string, info: { caption?: string }): void {
  const overlayStore = useOverlayStore();
  const overlayObject = overlayStore.liveOverlays[id];
  if (!overlayObject) return;

  const newCaption = info.caption ?? null;
  if (overlayObject.caption === newCaption) return;

  overlayStore.updateOverlay(id, { caption: newCaption });
}

// The user's last edited position (history.at(-1)) is the source of truth; fall back to
// the stored backend corners for an unedited overlay. Null when the overlay has no footprint.
export function getCornersFromOverlay(overlay: OverlayObject): LatLng[] | null {
  const lastEdited = overlay.history.at(-1)?.corners;
  if (isValidQuad(lastEdited)) return lastEdited;
  return isValidQuad(overlay.baselineCorners) ? overlay.baselineCorners : null;
}

// Images upload to local storage first and migrate to R2 only after moderator approval.
async function prepareImageForServer(overlay: OverlayObject): Promise<string> {
  if (overlay.imageUrl.startsWith("data:")) {
    const response = await fetch(overlay.imageUrl);
    const blob = await response.blob();

    if (blob.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
      throw new Error(t("upload.fileTooLarge", { maxSize: MAX_UPLOAD_FILE_SIZE_MB }));
    }

    // Name the file from its real type so the backend records the correct source extension
    // (it stores the pre-compression original under this extension, and a wrong .webp name on
    // PNG/JPEG bytes would mislabel a kept-as-is original).
    const type = blob.type || "image/webp";
    let extension = "webp";
    if (type === "image/png") extension = "png";
    else if (type === "image/jpeg") extension = "jpg";
    const file = new File([blob], `overlay-image.${extension}`, { type });

    const formData = new FormData();
    formData.append("image", file);

    const uploadResponse = await fetch(`${getApiUrl()}/api/upload-image`, {
      method: "POST",
      body: formData,
      credentials: "include",
    });

    if (!uploadResponse.ok) {
      // The endpoint returns { error } where error is an i18n key (e.g. the storage quota or
      // rate-limit message); translate it so the user sees the real reason, not a generic failure.
      let message = t("upload.error.uploadFailed");
      try {
        const body: { error?: string } = await uploadResponse.json();
        if (body.error) message = t(body.error);
      } catch {
        // Non-JSON body: keep the generic message.
      }
      throw new Error(message);
    }
    const uploadResult: { filename: string } = await uploadResponse.json();

    return uploadResult.filename;
  } else {
    // Extract filename from existing server URL
    const urlParts = overlay.imageUrl.split("/");
    const filename = urlParts[urlParts.length - 1];

    if (!filename) {
      throw new Error(t("overlay.publishErrorNoFilename"));
    }

    return filename;
  }
}

async function ensureProjectOnServer(project: Project): Promise<void> {
  const projectStore = useProjectStore();
  const projectResult = await trpc.project.publishProject.mutate(projectSchema.parse(project));

  // The backend upserts on the supplied UUID, so projectResult.id always matches project.id.
  // Newly-inserted projects (exists === false) need their local status flipped to pending and
  // a contributions-cache entry so the sidebar reflects the submission.
  if (projectResult.id && !projectResult.exists) {
    projectStore.updateProject(project.id, { status: "pending" });
    const updatedProject = projectStore.projects[project.id];
    if (updatedProject) {
      projectStore.addProjectToUserContributions(updatedProject);
    }
  }
}

function handlePostPublishUpdates(
  overlay: OverlayObject,
  project: Project | null,
  filename: string,
): void {
  if (project) {
    const projectStore = useProjectStore();
    const authStore = useAuthStore();
    const overlayStore = useOverlayStore();
    const existingOverlays = Object.values(overlayStore.liveOverlays).filter(
      (o) => o.projectId === project.id && o.id !== overlay.id,
    );

    projectStore.addOverlayToUserContributions(
      overlay,
      project,
      filename,
      authStore.user?.username ?? null,
      existingOverlays,
    );
  }
}

export async function publishOverlay(
  overlay: OverlayObject,
  project: Project | null,
): Promise<void> {
  // For brand-new projects, publish the project first so the overlay can reference it.
  if (project?.status === null) {
    await ensureProjectOnServer(project);
  }

  const filename = await prepareImageForServer(overlay);

  if (!overlay.projectId) {
    throw new Error(t("overlay.publishErrorNoProjectId"));
  }

  const corners = getCornersFromOverlay(overlay);
  if (!corners) {
    throw new Error(t("overlay.publishErrorNoCorners"));
  }
  const payload = {
    id: overlay.id,
    filename,
    caption: overlay.caption ?? undefined,
    projectId: overlay.projectId,
    replacesOverlayId: overlay.replacesOverlayId ?? undefined,
    corners: corners.map((c) => ({ lat: c.lat, lng: c.lng })),
  };

  const publishResult = await trpc.overlay.publishOverlay.mutate(payload);

  if (publishResult.id) {
    overlay.status = publishResult.status;
    overlay.authorId = publishResult.authorId ?? null;

    // Point to the server URL so the image isn't re-uploaded on the next save.
    // The backend serves uploads under /uploads/ (no /api/images endpoint exists).
    overlay.imageUrl = `${getApiUrl()}/uploads/${filename}`;
    overlay.filename = filename;

    handlePostPublishUpdates(overlay, project, filename);
  }

  // Don't reload city overlays immediately, the local state already reflects the
  // publish response and a refetch would overwrite it with stale backend data.
}
