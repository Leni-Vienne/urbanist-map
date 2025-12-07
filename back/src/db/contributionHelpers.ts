import { db } from "../database";
import { projects, overlays } from "./schema";
import { eq, and, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// AI : Maximum number of pending contributions (projects + overlays) per user
export const MAX_PENDING_CONTRIBUTIONS = 50;

// AI : Count total pending contributions for a user
export async function countPendingContributions(userId: string): Promise<number> {
  try {
    // AI : Count pending projects authored by user
    const [pendingProjects] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(projects)
      .where(and(eq(projects.ownerId, userId), eq(projects.status, "pending")));

    // AI : Count pending overlays authored by user
    const [pendingOverlays] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(overlays)
      .where(and(eq(overlays.authorId, userId), eq(overlays.status, "pending")));

    const totalPending = (pendingProjects?.count ?? 0) + (pendingOverlays?.count ?? 0);
    return totalPending;
  } catch (error) {
    console.error("Failed to count pending contributions:", error);
    return 0;
  }
}

// AI : Check if user has reached the pending contribution limit
export async function hasReachedPendingLimit(userId: string): Promise<boolean> {
  const count = await countPendingContributions(userId);
  return count >= MAX_PENDING_CONTRIBUTIONS;
}

// AI : Check pending limit and throw error if reached (for new contributions only)
export async function checkPendingLimitForNewContribution(
  userId: string,
  entityId?: string,
): Promise<void> {
  // AI : If entity ID exists, check if it's a new contribution
  if (entityId) {
    // AI : Check if overlay or project already exists
    const [existingOverlay] = await db
      .select({ id: overlays.id })
      .from(overlays)
      .where(eq(overlays.id, entityId))
      .limit(1);

    const [existingProject] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, entityId))
      .limit(1);

    // AI : If entity exists, it's an edit, not a new contribution
    if (existingOverlay || existingProject) {
      return;
    }
  }

  // AI : Check if user has reached the limit
  const reachedLimit = await hasReachedPendingLimit(userId);
  if (reachedLimit) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `You have reached the maximum of ${MAX_PENDING_CONTRIBUTIONS} pending contributions. Please wait for your existing contributions to be reviewed before submitting more.`,
    });
  }
}
