import { and, eq, inArray, or } from "drizzle-orm";
import type { SubmissionBatchInput } from "@shared/validation/schemas";
import type { Transaction } from "../database";
import { changeRequests, importSources, overlays, projects } from "../db/schema";
import {
  buildOverlayModerationQuery,
  fetchMapOverlaysById,
  withOwnOverlayProposals,
  PROJECT_COLUMNS,
  IMPORT_SOURCE_COLUMNS,
} from "../db/helpers";
import type { SessionUser } from "../lib/types";
import { getMyChangeRequests } from "../db/changeRequests";

// Read inside the write transaction: a successful response acknowledges exactly the entities
// submitted, including database defaults, versions and the caller's remaining open requests.
export async function getSubmissionReceipt(
  tx: Transaction,
  input: SubmissionBatchInput,
  user: SessionUser,
) {
  const overlayIds = input.overlays.map((overlay) => overlay.id);
  const imageIds = input.render ? [...overlayIds, input.render.id] : overlayIds;
  const [[project], overlayRows, imageRows, requests] = await Promise.all([
    tx
      .select({ ...PROJECT_COLUMNS, importSource: IMPORT_SOURCE_COLUMNS })
      .from(projects)
      .leftJoin(importSources, eq(importSources.id, projects.importSourceId))
      .where(eq(projects.id, input.projectId)),
    fetchMapOverlaysById(tx, overlayIds),
    buildOverlayModerationQuery(tx).where(inArray(overlays.id, imageIds)),
    getMyChangeRequests(
      tx,
      user.id,
      or(
        and(eq(changeRequests.entityType, "project"), eq(changeRequests.entityId, input.projectId)),
        and(eq(changeRequests.entityType, "overlay"), inArray(changeRequests.entityId, overlayIds)),
      ),
    ),
  ]);
  if (!project) throw new Error("Submitted project disappeared before acknowledgement");
  const pendingOverlayChanges = requests.filter(
    (request) => request.entityType === "overlay" && request.status === "pending",
  );
  const mapOverlays = withOwnOverlayProposals(overlayRows, pendingOverlayChanges);
  return { project, mapOverlays, images: imageRows, changeRequests: requests };
}
