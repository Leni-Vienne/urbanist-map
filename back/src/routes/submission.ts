import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { submissionBatchSchema, type SubmissionBatchInput } from "@shared/validation/schemas";
import { calculateCentroidFromCorners } from "@shared/overlayValidation";
import { buildProjectSlug } from "@shared/projectSlug";
import { db, type Transaction } from "../database";
import { changeRequests, overlays, projects } from "../db/schema";
import { isUserBlocked } from "../db/helpers";
import { resolveCountryCode, assignProjectBoundary } from "../db/boundaryAssignment";
import { scalarGeometrySizeMSql } from "../db/geometrySize";
import { deleteLocalImages } from "../lib/imageCleanup";
import * as rateLimit from "../lib/rateLimit";
import { notifyNewSubmission } from "../services/discordNotifier";
import {
  classifySubmission,
  type ClassifiedChangeRequest,
  type SubmissionPlan,
} from "../services/submissionPolicy";
import { loggedInProcedure, router, TRPCError } from "../trpc";
import { getClientIp } from "../utils/ip";
import type { SessionUser } from "../lib/types";
import { getMyChangeRequests } from "./changes";
import { getEditSessionData } from "../services/editSession";

const MAX_PENDING_CONTRIBUTIONS = 50;
const MAX_TOTAL_CONTRIBUTIONS = 2000;

function normalizePrecisionForStorage(
  date: Date | null | undefined,
  precision: "year" | "month" | "day" | null | undefined,
) {
  return date ? (precision ?? "day") : null;
}

function overlayCornersSql(corners: { lat: number; lng: number }[]) {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  return sql`ST_SetSRID(ST_MakePolygon(
    ST_MakeLine(ARRAY[
      ST_MakePoint(${topLeft?.lng}, ${topLeft?.lat}),
      ST_MakePoint(${topRight?.lng}, ${topRight?.lat}),
      ST_MakePoint(${bottomRight?.lng}, ${bottomRight?.lat}),
      ST_MakePoint(${bottomLeft?.lng}, ${bottomLeft?.lat}),
      ST_MakePoint(${topLeft?.lng}, ${topLeft?.lat})
    ])
  ), 4326)`;
}

const PROJECT_SUBMISSION_COLUMNS = {
  id: projects.id,
  status: projects.status,
  ownerId: projects.ownerId,
  name: projects.name,
  description: projects.description,
  sourceUrl: projects.sourceUrl,
  timelineStatus: projects.timelineStatus,
  proposalDate: projects.proposalDate,
  startDate: projects.startDate,
  endDate: projects.endDate,
  endDatePrecision: projects.endDatePrecision,
  proposalDatePrecision: projects.proposalDatePrecision,
  startDatePrecision: projects.startDatePrecision,
  geometry: sql<GeoJSON.GeometryCollection | null>`CASE WHEN ${projects.geometry} IS NULL THEN NULL ELSE ST_AsGeoJSON(${projects.geometry})::json END`,
  tags: projects.tags,
  lat: projects.lat,
  lng: projects.lng,
} as const;

const OVERLAY_SUBMISSION_COLUMNS = {
  id: overlays.id,
  status: overlays.status,
  authorId: overlays.authorId,
  filename: overlays.filename,
  caption: overlays.caption,
  kind: overlays.kind,
  projectId: overlays.projectId,
  corners: sql<{ lat: number; lng: number }[]>`(
    SELECT json_agg(json_build_object('lat', ST_Y(geom), 'lng', ST_X(geom)) ORDER BY path[2])
    FROM ST_DumpPoints(${overlays.corners}) AS dump(path, geom)
    WHERE path[2] <= 4
  )`,
  lat: sql<number>`ST_Y(${overlays.centroid})`,
  lng: sql<number>`ST_X(${overlays.centroid})`,
} as const;

async function loadSubmissionState(tx: Transaction, input: SubmissionBatchInput, userId: string) {
  const submittedOverlayIds = [
    ...input.overlays.map((overlay) => overlay.id),
    ...(input.render ? [input.render.id] : []),
  ];
  const existingProjectRows = await tx
    .select(PROJECT_SUBMISSION_COLUMNS)
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  const existingOverlayRows =
    submittedOverlayIds.length > 0
      ? await tx
          .select(OVERLAY_SUBMISSION_COLUMNS)
          .from(overlays)
          .where(inArray(overlays.id, submittedOverlayIds))
      : [];
  const existingProject = existingProjectRows[0];
  const existingOverlays = new Map(existingOverlayRows.map((row) => [row.id, row]));

  const [[pendingProjects], [pendingOverlays], [totalProjects], [totalOverlays]] =
    await Promise.all([
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(projects)
        .where(and(eq(projects.ownerId, userId), eq(projects.status, "pending"))),
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(overlays)
        .where(and(eq(overlays.authorId, userId), eq(overlays.status, "pending"))),
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(projects)
        .where(
          and(eq(projects.ownerId, userId), inArray(projects.status, ["approved", "pending"])),
        ),
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(overlays)
        .where(
          and(eq(overlays.authorId, userId), inArray(overlays.status, ["approved", "pending"])),
        ),
    ]);
  return {
    existingProject,
    existingOverlays,
    currentPending: (pendingProjects?.count ?? 0) + (pendingOverlays?.count ?? 0),
    currentTotal: (totalProjects?.count ?? 0) + (totalOverlays?.count ?? 0),
  };
}

type Notification = Parameters<typeof notifyNewSubmission>[0];
type SubmissionState = Awaited<ReturnType<typeof loadSubmissionState>>;

function validateContributionLimits(
  input: SubmissionBatchInput,
  plan: SubmissionPlan,
  state: SubmissionState,
): void {
  const statuses = [];
  if (plan.project) statuses.push(state.existingProject?.status);
  for (const overlay of plan.overlays) {
    statuses.push(state.existingOverlays.get(overlay.id)?.status);
  }
  if (input.render) statuses.push(state.existingOverlays.get(input.render.id)?.status);

  let pendingAdditions = 0;
  let totalAdditions = 0;
  for (const status of statuses) {
    if (status !== "pending") pendingAdditions += 1;
    if (status !== "pending" && status !== "approved") totalAdditions += 1;
  }
  if (state.currentPending + pendingAdditions > MAX_PENDING_CONTRIBUTIONS) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `You have reached the maximum of ${MAX_PENDING_CONTRIBUTIONS} pending contributions. Please wait for your existing contributions to be reviewed before submitting more.`,
    });
  }
  if (state.currentTotal + totalAdditions > MAX_TOTAL_CONTRIBUTIONS) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `You have reached the maximum lifetime limit of ${MAX_TOTAL_CONTRIBUTIONS} contributions.`,
    });
  }
}

function submissionOutcome(
  input: SubmissionBatchInput,
  plan: SubmissionPlan,
  state: SubmissionState,
) {
  let createdEntities = plan.project && !state.existingProject ? 1 : 0;
  for (const overlay of plan.overlays) {
    if (!state.existingOverlays.has(overlay.id)) createdEntities += 1;
  }
  if (input.render && !state.existingOverlays.has(input.render.id)) createdEntities += 1;
  return { createdEntities, changeRequests: plan.changeRequests.length };
}

async function writeProject(
  tx: Transaction,
  project: NonNullable<SubmissionBatchInput["project"]>,
  countryCode: string,
  slug: string | null,
  user: SessionUser,
  existing: SubmissionState["existingProject"],
  notifications: Notification[],
): Promise<void> {
  if (existing) {
    if (existing.ownerId !== user.id) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You can only modify your own projects" });
    }
    if (existing.status === "approved") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot directly modify an approved project",
      });
    }
  }

  const geometry = project.geometry
    ? sql`ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(project.geometry)}), 4326))`
    : null;
  const values = {
    name: project.name,
    description: project.description ?? null,
    countryCode,
    timelineStatus: project.timelineStatus,
    lat: project.lat,
    lng: project.lng,
    centerCoordinate: sql`ST_SetSRID(ST_MakePoint(${project.lng}, ${project.lat}), 4326)`,
    proposalDate: project.proposalDate ?? null,
    proposalDatePrecision: normalizePrecisionForStorage(
      project.proposalDate,
      project.proposalDatePrecision,
    ),
    startDate: project.startDate ?? null,
    startDatePrecision: normalizePrecisionForStorage(project.startDate, project.startDatePrecision),
    endDate: project.endDate ?? null,
    endDatePrecision: normalizePrecisionForStorage(project.endDate, project.endDatePrecision),
    sourceUrl: project.sourceUrl ?? null,
    geometry,
    geometrySizeM: geometry ? scalarGeometrySizeMSql(geometry) : null,
    tags: project.tags,
  };

  if (existing) {
    const updated = await tx
      .update(projects)
      .set({
        ...values,
        status: "pending",
        rejectionReason: null,
        version: sql`${projects.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(projects.id, project.id),
          eq(projects.ownerId, user.id),
          or(eq(projects.status, "pending"), eq(projects.status, "rejected")),
        ),
      )
      .returning({ id: projects.id });
    if (!updated[0]) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Project status changed while it was being updated",
      });
    }
    return;
  }

  await tx.insert(projects).values({ ...values, id: project.id, ownerId: user.id, slug });
  notifications.push({
    kind: "project",
    author: { email: user.email, username: user.username },
    projectId: project.id,
    projectName: project.name,
    countryCode,
    lat: project.lat,
    lng: project.lng,
  });
}

async function writeOverlay(
  tx: Transaction,
  overlay: SubmissionBatchInput["overlays"][number],
  projectId: string,
  user: SessionUser,
  existingOverlays: SubmissionState["existingOverlays"],
  notifications: Notification[],
  supersededFilenames: string[],
): Promise<void> {
  const existing = existingOverlays.get(overlay.id);
  if (existing && existing.kind !== "map") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Overlay kind cannot be changed" });
  }
  if (existing?.status === "approved") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "APPROVED_OVERLAY_REQUIRES_CHANGE_REQUEST",
    });
  }
  if (existing && existing.authorId !== user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized to modify this overlay" });
  }
  const filenameClaim = await tx
    .select({ id: overlays.id })
    .from(overlays)
    .where(and(eq(overlays.filename, overlay.filename), ne(overlays.id, overlay.id)))
    .limit(1);
  if (filenameClaim[0]) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "validation.filenameInvalid" });
  }
  if (overlay.replacesOverlayId) {
    const replacementTarget = await tx
      .select({ id: overlays.id })
      .from(overlays)
      .where(
        and(
          eq(overlays.id, overlay.replacesOverlayId),
          eq(overlays.projectId, projectId),
          eq(overlays.status, "approved"),
        ),
      )
      .limit(1);
    if (!replacementTarget[0]) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A replacement must target an approved overlay from the same project",
      });
    }
  }

  const centroid = calculateCentroidFromCorners(overlay.corners);
  if (!centroid) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid corner coordinates" });
  }
  const values = {
    filename: overlay.filename,
    caption: overlay.caption,
    projectId,
    authorId: user.id,
    replacesOverlayId: overlay.replacesOverlayId ?? null,
    corners: overlayCornersSql(overlay.corners),
    centroid: sql`ST_SetSRID(ST_MakePoint(${centroid.lng}, ${centroid.lat}), 4326)`,
  };
  if (existing) {
    const updated = await tx
      .update(overlays)
      .set({
        ...values,
        status: "pending",
        rejectionReason: null,
        version: sql`${overlays.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(overlays.id, overlay.id),
          eq(overlays.authorId, user.id),
          or(eq(overlays.status, "pending"), eq(overlays.status, "rejected")),
        ),
      )
      .returning({ id: overlays.id });
    if (!updated[0]) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Overlay status changed while it was being updated",
      });
    }
    if (existing.filename !== overlay.filename) supersededFilenames.push(existing.filename);
    return;
  }

  await tx.insert(overlays).values({ id: overlay.id, ...values });
  notifications.push({
    kind: "overlay",
    author: { email: user.email, username: user.username },
    overlayId: overlay.id,
    caption: overlay.caption ?? null,
    projectId,
    lat: centroid.lat,
    lng: centroid.lng,
  });
}

type SubmittedRender = {
  id: string;
  filename: string;
  status: "pending";
  authorId: string | null;
};

async function writeRender(
  tx: Transaction,
  render: NonNullable<SubmissionBatchInput["render"]>,
  projectId: string,
  user: SessionUser,
  existingOverlays: SubmissionState["existingOverlays"],
  notifications: Notification[],
  supersededFilenames: string[],
): Promise<SubmittedRender> {
  const existing = existingOverlays.get(render.id);
  if (existing && existing.kind !== "render") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Overlay kind cannot be changed" });
  }
  if (existing?.status === "approved") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Approved render cannot be changed" });
  }
  if (existing && existing.authorId !== user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized to modify this render" });
  }
  const project = await tx
    .select({ lat: projects.lat, lng: projects.lng })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project[0]) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }
  const filenameClaim = await tx
    .select({ id: overlays.id })
    .from(overlays)
    .where(and(eq(overlays.filename, render.filename), ne(overlays.id, render.id)))
    .limit(1);
  if (filenameClaim[0]) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "validation.filenameInvalid" });
  }

  if (existing) {
    const updated = await tx
      .update(overlays)
      .set({
        filename: render.filename,
        projectId,
        status: "pending",
        rejectionReason: null,
        version: sql`${overlays.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(overlays.id, render.id),
          eq(overlays.authorId, user.id),
          or(eq(overlays.status, "pending"), eq(overlays.status, "rejected")),
        ),
      )
      .returning({ id: overlays.id });
    if (!updated[0]) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Render status changed while it was being updated",
      });
    }
    if (existing.filename !== render.filename) supersededFilenames.push(existing.filename);
  } else {
    await tx.insert(overlays).values({
      id: render.id,
      filename: render.filename,
      projectId,
      authorId: user.id,
      kind: "render",
    });
    notifications.push({
      kind: "overlay",
      author: { email: user.email, username: user.username },
      overlayId: render.id,
      caption: null,
      projectId,
      lat: project[0].lat,
      lng: project[0].lng,
    });
  }
  return { id: render.id, filename: render.filename, status: "pending", authorId: user.id };
}

async function writeChangeRequest(
  tx: Transaction,
  request: ClassifiedChangeRequest,
  user: SessionUser,
  notifications: Notification[],
): Promise<void> {
  for (const change of request.changes) {
    await tx
      .delete(changeRequests)
      .where(
        and(
          eq(changeRequests.entityType, request.entityType),
          eq(changeRequests.entityId, request.entityId),
          eq(changeRequests.fieldName, change.fieldName),
          eq(changeRequests.requestedBy, user.id),
          inArray(changeRequests.status, ["pending", "conflicted"]),
        ),
      );
    await tx.insert(changeRequests).values({
      entityType: request.entityType,
      entityId: request.entityId,
      fieldName: change.fieldName,
      oldValue: change.oldValue,
      newValue: change.newValue,
      changeReason: change.changeReason,
      requestedBy: user.id,
      status: "pending",
    });
  }
  notifications.push({
    kind: "change_request",
    author: { email: user.email, username: user.username },
    entityType: request.entityType,
    entityId: request.entityId,
    changes: request.changes.map((change) => ({
      fieldName: change.fieldName,
      oldValue: change.oldValue,
      newValue: change.newValue,
      changeReason: change.changeReason,
    })),
    lat: request.lat,
    lng: request.lng,
  });
}

export const submissionRouter = router({
  submit: loggedInProcedure.input(submissionBatchSchema).mutation(async ({ input, ctx }) => {
    try {
      const userId = ctx.user.id;
      if (await isUserBlocked(userId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Your account has been flagged for review. Please contact support.",
        });
      }
      const committed = await db.transaction(async (tx) => {
        const state = await loadSubmissionState(tx, input, userId);
        const plan = classifySubmission(input, state);
        const outcome = submissionOutcome(input, plan, state);
        validateContributionLimits(input, plan, state);

        if (plan.changeRequests.length > 0) {
          const ip = getClientIp(ctx.hono);
          if (!rateLimit.check(ip, 20, 60 * 60 * 1000)) {
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: "Too many change requests. Please try again later.",
            });
          }
        }

        const countryCode = plan.project
          ? await resolveCountryCode(plan.project.lat, plan.project.lng)
          : null;
        if (plan.project && !countryCode) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Could not determine a country for this location",
          });
        }
        const projectSlug = plan.project
          ? buildProjectSlug({ name: plan.project.name, externalId: null, id: plan.project.id })
          : null;

        const notifications: Parameters<typeof notifyNewSubmission>[0][] = [];
        const supersededFilenames: string[] = [];

        if (plan.project && countryCode) {
          await writeProject(
            tx,
            plan.project,
            countryCode,
            projectSlug,
            ctx.user,
            state.existingProject,
            notifications,
          );
        }

        for (const overlay of plan.overlays) {
          await writeOverlay(
            tx,
            overlay,
            input.projectId,
            ctx.user,
            state.existingOverlays,
            notifications,
            supersededFilenames,
          );
        }

        const render = input.render
          ? await writeRender(
              tx,
              input.render,
              input.projectId,
              ctx.user,
              state.existingOverlays,
              notifications,
              supersededFilenames,
            )
          : undefined;

        for (const request of plan.changeRequests) {
          await writeChangeRequest(tx, request, ctx.user, notifications);
        }

        const [editSession, myChangeRequests] = await Promise.all([
          getEditSessionData(tx, ctx.user),
          getMyChangeRequests(tx, userId),
        ]);
        return {
          notifications,
          supersededFilenames,
          render,
          editSession,
          changeRequests: myChangeRequests,
          directProjectId: plan.project?.id,
          outcome,
        };
      });

      if (committed.directProjectId) await assignProjectBoundary(committed.directProjectId);
      for (const filename of committed.supersededFilenames) {
        try {
          await deleteLocalImages(filename, "both");
        } catch (error) {
          console.error("Failed to delete superseded submission image:", filename, error);
        }
      }
      for (const notification of committed.notifications) void notifyNewSubmission(notification);

      return {
        editSession: committed.editSession,
        changeRequests: committed.changeRequests,
        render: committed.render,
        outcome: committed.outcome,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      console.error("Error submitting batch:", error);
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to submit changes" });
    }
  }),
});
