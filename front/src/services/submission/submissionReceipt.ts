import type { RouterOutput } from "@/client";
import { useProjectStore } from "@/stores/projectStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useContributionStore } from "@/stores/contributionStore";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { useUiStore } from "@/stores/uiStore";
import { overlayWireToData, projectFromWire } from "@/utils/typeFactories";
import { changeRequestFromWire } from "@/services/changes/changeRequestData";
import { mergeEditSession } from "@/services/map/mapSessionState";
import { renderMapSessionPendingSources } from "@/services/map/tiles/pendingSources";
import { scheduleOverlayReconcile } from "@/services/overlay/mapLayers";
import { invalidateContributionRequests } from "@/services/project/userContributions";
import { acknowledgeStagedRender } from "./stagedRenderState";
import type { SubmissionBatchInput } from "@shared/validation/schemas";

type SubmissionResult = RouterOutput["submission"]["submit"];

export function acknowledgeSubmission(result: SubmissionResult, batch: SubmissionBatchInput): void {
  const projectStore = useProjectStore();
  const contributionStore = useContributionStore();
  const changeStore = useChangeRequestStore();
  const { receipt, render } = result;
  invalidateContributionRequests();
  projectStore.upsertProjectSummary(projectFromWire(receipt.project));
  if (batch.project) projectStore.discardProjectDraft(batch.projectId);

  for (const overlay of receipt.mapOverlays) {
    useOverlayStore().ingestBackendOverlay(overlayWireToData(overlay), false);
  }
  if (!contributionStore.projectIds.includes(batch.projectId)) {
    contributionStore.projectIds.push(batch.projectId);
  }
  for (const image of receipt.images) contributionStore.overlaysById[image.id] = image;
  const overlayIds = new Set(batch.overlays.map((overlay) => overlay.id));
  changeStore.pendingChangeRequests = [
    ...changeStore.pendingChangeRequests.filter((request) =>
      request.entityType === "project"
        ? request.entityId !== batch.projectId
        : !overlayIds.has(request.entityId),
    ),
    ...receipt.changeRequests.map(changeRequestFromWire),
  ];
  if (render) {
    projectStore.updatePersistedProject(batch.projectId, {
      render: { filename: render.filename, caption: null, status: render.status },
    });
    acknowledgeStagedRender(batch.projectId);
  }
  if (useUiStore().mode === "edit") mergeEditSession(batch.projectId, [...overlayIds]);
  renderMapSessionPendingSources();
  scheduleOverlayReconcile();
}
