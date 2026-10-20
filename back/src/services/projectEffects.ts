import { db } from "../database";
import { assignProjectBoundary } from "../db/boundaryAssignment";
import { refreshProjectIndexable } from "../db/indexable";
import { captureProjectMapState, type ProjectMapState } from "../db/projectMapState";
import { invalidateLatestContributionsCache } from "../routes/feed";
import { invalidateTileBounds } from "../routes/tiles";

// The write has committed. Each derived-data task is independent, and none may turn a
// successful mutation into an error that invites the caller to repeat the write.
export async function reconcileProjectChanges(before: ProjectMapState): Promise<void> {
  for (const projectId of before.projectIds) {
    for (const refresh of [assignProjectBoundary, refreshProjectIndexable]) {
      try {
        await refresh(projectId);
      } catch (error) {
        console.error(`Failed to refresh derived data for project ${projectId}:`, error);
      }
    }
  }

  try {
    const after = await captureProjectMapState(db, before.projectIds);
    invalidateTileBounds([...before.bounds, ...after.bounds]);
  } catch (error) {
    console.error("Failed to capture changed project bounds; clearing tile cache:", error);
    invalidateTileBounds(null);
  }

  invalidateLatestContributionsCache();
}
