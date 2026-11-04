import { useMapSessionStore } from "@/stores/mapSessionStore";
import { useSubmissionStore } from "@/stores/submissionStore";
import type { RouterOutput } from "@/client";
import { useProjectStore } from "@/stores/projectStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useContributionStore } from "@/stores/contributionStore";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { useUiStore } from "@/stores/uiStore";
import { overlayWireToData, projectFromWire } from "@/utils/typeFactories";
import { changeRequestFromWire } from "@/services/changes/changeRequestData";
import type { SubmissionBatchInput } from "@shared/validation/schemas";

type SubmissionResult = RouterOutput["submission"]["submit"];

export function acknowledgeSubmission(result: SubmissionResult, batch: SubmissionBatchInput): void {
  const projectStore = useProjectStore();
  const contributionStore = useContributionStore();
  const changeStore = useChangeRequestStore();
  const { receipt, render } = result;
  contributionStore.invalidateRequests();
  projectStore.upsertProjectSummary(projectFromWire(receipt.project));
  if (batch.project) projectStore.discardProjectDraft(batch.projectId);

  for (const overlay of receipt.mapOverlays) {
    useOverlayStore().ingestBackendOverlay(overlayWireToData(overlay), false);
  }
  contributionStore.ingestReceipt(batch.projectId, receipt.images);
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
    useSubmissionStore().acknowledgeStagedRender(batch.projectId);
  }
  if (useUiStore().mode === "edit")
    useMapSessionStore().mergeEditSession(batch.projectId, [...overlayIds]);
}
