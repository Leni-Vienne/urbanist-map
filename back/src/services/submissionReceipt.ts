import { and, eq, inArray, or } from "drizzle-orm";
import type { SubmissionBatchInput } from "@shared/validation/schemas";
import type { Transaction } from "../database";
import { changeRequests, importSources, overlays, projects } from "../db/schema";
import { buildOverlayModerationQuery, fetchOverlaysForMap, PROJECT_COLUMNS } from "../db/helpers";
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
  const [[project], mapData, imageRows, requests] = await Promise.all([
    tx
      .select({ ...PROJECT_COLUMNS, importSource: importSources })
      .from(projects)
      .leftJoin(importSources, eq(importSources.id, projects.importSourceId))
      .where(eq(projects.id, input.projectId)),
    fetchOverlaysForMap(tx, [inArray(overlays.id, overlayIds)], user),
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
  return { project, mapOverlays: mapData.overlays, images: imageRows, changeRequests: requests };
}
