import { useProjectStore } from "@/stores/projectStore";
import { trpc, getApiUrl } from "@/client";
import type { LatLng, OverlayObject, Project } from "@/types/index";
import { projectSchema } from "@shared/validation/schemas";
import { MAX_UPLOAD_FILE_SIZE_BYTES, MAX_UPLOAD_FILE_SIZE_MB } from "@shared/uploadLimits";
import { t } from "@/locales";
import { useAuthStore } from "@/stores/authStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { isValidQuad } from "@/services/overlay/transform";

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

export function useOverlayPublisher() {
  const projectStore = useProjectStore();

  async function ensureProjectOnServer(project: Project): Promise<void> {
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

  async function publishOverlay(overlay: OverlayObject, project: Project | null): Promise<void> {
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

  return {
    publishOverlay,
  };
}
