import { db } from "../database";
import { projects, overlays } from "./schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// AI : Maximum number of pending contributions (projects + overlays) per user
const MAX_PENDING_CONTRIBUTIONS = 50;

// AI : Lifetime limit: 2000 total approved/pending contributions (projects + overlays) per user
// AI : This prevents database bloat and storage abuse (approx 10-20GB max per user)
const MAX_TOTAL_CONTRIBUTIONS = 2000;

// AI : Count total pending contributions for a user
async function countPendingContributions(userId: string): Promise<number> {
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
async function hasReachedPendingLimit(userId: string): Promise<boolean> {
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

    // AI : If entity exists, check its status
    if (existingEntity) {
      // AI : If it's already pending, this is just an edit to a pending item
      // AI : We don't count it as a "new" pending contribution since it's already counted
      if (existingEntity.status === "pending") {
        return;
      }
      // AI : If it's NOT pending (e.g. rejected or approved), and we're submitting it
      // AI : It will become 'pending' again, so we must check the limit!
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

export async function checkTotalContributionLimit(userId: string): Promise<void> {
  // AI : Count all contributions (approved + pending)
  const [userProjects] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(projects)
    .where(and(eq(projects.ownerId, userId), inArray(projects.status, ["approved", "pending"])));

  const [userOverlays] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(overlays)
    .where(and(eq(overlays.authorId, userId), inArray(overlays.status, ["approved", "pending"])));

  const total = (userProjects?.count ?? 0) + (userOverlays?.count ?? 0);

  if (total >= MAX_TOTAL_CONTRIBUTIONS) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `You have reached the maximum lifetime limit of ${MAX_TOTAL_CONTRIBUTIONS} contributions.`,
    });
  }
}
