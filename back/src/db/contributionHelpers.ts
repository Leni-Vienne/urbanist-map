import { db } from "../database";
import { projects, overlays } from "./schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// Maximum number of pending contributions (projects + overlays) per user
const MAX_PENDING_CONTRIBUTIONS = 50;

// Lifetime limit: 2000 total approved/pending contributions (projects + overlays) per user
// This prevents database bloat and storage abuse (approx 10-20GB max per user)
const MAX_TOTAL_CONTRIBUTIONS = 2000;

// Count total pending contributions for a user
async function countPendingContributions(userId: string): Promise<number> {
  try {
    // Count pending projects authored by user
    const [pendingProjects] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(projects)
      .where(and(eq(projects.ownerId, userId), eq(projects.status, "pending")));

    // Count pending overlays authored by user
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

// Check if user has reached the pending contribution limit
async function hasReachedPendingLimit(userId: string): Promise<boolean> {
  const count = await countPendingContributions(userId);
  return count >= MAX_PENDING_CONTRIBUTIONS;
}

// Check pending limit and throw error if reached (for new contributions only)
export async function checkPendingLimitForNewContribution(
  userId: string,
  entityId?: string,
): Promise<void> {
  // If entity ID exists, check if it's a new contribution
  if (entityId) {
    try {
      // Check if overlay or project already exists
      const [existingOverlay] = await db
        .select({ id: overlays.id, status: overlays.status })
        .from(overlays)
        .where(eq(overlays.id, entityId))
        .limit(1);

      const [existingProject] = await db
        .select({ id: projects.id, status: projects.status })
        .from(projects)
        .where(eq(projects.id, entityId))
        .limit(1);

      const existingEntity = existingOverlay ?? existingProject;

      // An already-pending item is just an edit, already counted, so it skips the limit check.
      // A non-pending item (rejected/approved) becomes pending again, so it must be checked.
      if (existingEntity?.status === "pending") {
        return;
      }
    } catch (error) {
      console.error("Failed to look up existing contribution status:", error);
      // Fall through to the pending-limit check rather than blocking on a lookup error.
    }
  }

  // Check if user has reached the limit
  const reachedLimit = await hasReachedPendingLimit(userId);
  if (reachedLimit) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `You have reached the maximum of ${MAX_PENDING_CONTRIBUTIONS} pending contributions. Please wait for your existing contributions to be reviewed before submitting more.`,
    });
  }
}

export async function checkTotalContributionLimit(userId: string): Promise<void> {
  let total = 0;
  try {
    // Count all contributions (approved + pending)
    const [userProjects] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(projects)
      .where(and(eq(projects.ownerId, userId), inArray(projects.status, ["approved", "pending"])));

    const [userOverlays] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(overlays)
      .where(and(eq(overlays.authorId, userId), inArray(overlays.status, ["approved", "pending"])));

    total = (userProjects?.count ?? 0) + (userOverlays?.count ?? 0);
  } catch (error) {
    console.error("Failed to count total contributions:", error);
    // Fail open: a count error should not block an otherwise valid submission.
    return;
  }

  if (total >= MAX_TOTAL_CONTRIBUTIONS) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `You have reached the maximum lifetime limit of ${MAX_TOTAL_CONTRIBUTIONS} contributions.`,
    });
  }
}
