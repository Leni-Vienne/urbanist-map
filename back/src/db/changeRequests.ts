import { and, eq, or, sql, type SQL } from "drizzle-orm";
import type { DatabaseExecutor } from "../database";
import { changeRequests, users, userReports } from "./schema";

// Common select fields for change requests with user info
const changeRequestSelectFields = {
  id: changeRequests.id,
  entityType: changeRequests.entityType,
  entityId: changeRequests.entityId,
  fieldName: changeRequests.fieldName,
  oldValue: changeRequests.oldValue,
  newValue: changeRequests.newValue,
  changeReason: changeRequests.changeReason,
  status: changeRequests.status,
  requestedBy: changeRequests.requestedBy,
  requestedByUsername: users.username,
  requestedByReportCount:
    sql<number>`(SELECT COUNT(DISTINCT ${userReports.reportedBy})::int FROM ${userReports} WHERE ${userReports.reportedUserId} = ${changeRequests.requestedBy})`.as(
      "requestedByReportCount",
    ),
  createdAt: changeRequests.createdAt,
} as const;

export async function getMyChangeRequests(database: DatabaseExecutor, userId: string, scope?: SQL) {
  const rows = await database
    .select(changeRequestSelectFields)
    .from(changeRequests)
    .leftJoin(users, eq(changeRequests.requestedBy, users.id))
    .where(
      and(
        eq(changeRequests.requestedBy, userId),
        or(eq(changeRequests.status, "pending"), eq(changeRequests.status, "conflicted")),
        scope,
      ),
    )
    .orderBy(changeRequests.createdAt);

  return rows.map((change) =>
    Object.assign({}, change, { hasConflict: change.status === "conflicted" }),
  );
}
