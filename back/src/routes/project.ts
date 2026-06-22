import { publicProcedure, loggedInProcedure, router } from "../trpc";
import * as z from "zod"; // Smaller bundle compared to 'import { z } from 'zod';
import { projects, overlays, changeRequests, importSources, users } from "../db/schema";
import { eq, sql, and, or, inArray, isNull, ne, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../database";
import {
  buildProjectWithLocationQuery,
  buildOverlayModerationQuery,
  buildOverlayVisibilityCondition,
  buildPaginationConditions,
  buildPaginationResponse,
  isUserBlocked,
  PROJECT_COLUMNS,
} from "../db/helpers";
import {
  checkPendingLimitForNewContribution,
  checkTotalContributionLimit,
} from "../db/contributionHelpers";
import { deleteLocalImages } from "../lib/imageCleanup";
import { projectSchema } from "@shared/validation/schemas";
import { notifyNewSubmission } from "../services/discordNotifier";
import {
  assignProjectBoundary,
  resolveBoundaryPath,
  resolveCountryCode,
} from "../db/boundaryAssignment";

function normalizePrecisionForStorage(
  date: Date | null | undefined,
  precision: "year" | "month" | "day" | null | undefined,
) {
  if (!date) {
    return null;
  }

  return precision ?? "day";
}

// Use shared project schema for validation
const publishProjectSchema = projectSchema;

export const projectRouter = router({
  publishProject: loggedInProcedure.input(publishProjectSchema).mutation(async ({ input, ctx }) => {
    try {
      // Spam prevention - block banned or heavily reported users
      if (await isUserBlocked(ctx.user.id)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Your account has been flagged for review. Please contact support.",
        });
      }

      if (!input.id) {
        await checkTotalContributionLimit(ctx.user.id);
      }

      await checkPendingLimitForNewContribution(ctx.user.id, input.id);

      // Country is derived from the admin boundary covering (or nearest to) the project's location,
      // never sent by the client. A project can only exist somewhere a boundary places it.
      const countryCode = await resolveCountryCode(input.lat, input.lng);
      if (!countryCode) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Could not determine a country for this location",
        });
      }

      // Build data object with proper null handling for dates and precision
      const data = {
        ...input,
        ownerId: ctx.user.id,
        countryCode,
        proposalDate: input.proposalDate ?? null,
        proposalDatePrecision: normalizePrecisionForStorage(
          input.proposalDate,
          input.proposalDatePrecision,
        ),
        startDate: input.startDate ?? null,
        startDatePrecision: normalizePrecisionForStorage(input.startDate, input.startDatePrecision),
        endDate: input.endDate ?? null,
        endDatePrecision: normalizePrecisionForStorage(input.endDate, input.endDatePrecision),
        sourceUrl: input.sourceUrl,
        // Set center coordinate for all projects using PostGIS
        centerCoordinate: sql`ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)`,
        geometry: input.geometry
          ? sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(input.geometry)}), 4326)`
          : null,
        // Bbox diagonal in meters, used to exclude large-geometry projects from the cluster GeoJSON source
        geometrySizeM: input.geometry
          ? sql`ST_Length(ST_BoundingDiagonal(ST_Envelope(ST_GeomFromGeoJSON(${JSON.stringify(input.geometry)})))::geography)`
          : null,
      };

      if (input.id) {
        // Capture projectId in const for type narrowing inside transaction
        const projectId = input.id;

        // Use transaction to prevent race conditions between validation and update
        // This ensures status/ownership checks remain valid when update executes
        const publishTransaction = await db.transaction(async (tx) => {
          // Check if project exists and validate permissions
          const existingProject = await tx
            .select()
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

          const project = existingProject[0];
          if (!project) {
            return null;
          }

          // Security check - only owner can modify their project
          if (project.ownerId !== ctx.user.id) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You can only modify your own projects",
            });
          }

          // Workflow check - approved projects must use change request system
          if (project.status === "approved") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Cannot directly modify approved projects. Please use the change request system to suggest modifications.",
            });
          }

          // Allow updates only for pending/rejected projects owned by user
          const updateResult = await tx
            .update(projects)
            .set({
              name: data.name,
              description: data.description,
              countryCode: data.countryCode,
              lat: data.lat,
              lng: data.lng,
              centerCoordinate: data.centerCoordinate,
              proposalDate: data.proposalDate,
              proposalDatePrecision: data.proposalDatePrecision,
              startDate: data.startDate,
              startDatePrecision: data.startDatePrecision,
              endDate: data.endDate,
              endDatePrecision: data.endDatePrecision,
              sourceUrl: data.sourceUrl,
              geometry: data.geometry ?? null,
              geometrySizeM: data.geometrySizeM ?? null,
              ...(data.tags !== undefined && { tags: data.tags }),
              version: sql`${projects.version} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(projects.id, projectId))
            .returning();

          return updateResult[0];
        });

        if (publishTransaction) {
          await assignProjectBoundary(publishTransaction.id);
          return {
            id: publishTransaction.id,
            exists: true,
          };
        }
      }

      // Insert new project (with provided ID or auto-generated UUID)
      const result = await db
        .insert(projects)
        .values(input.id ? { ...data, id: input.id } : data)
        .returning();

      const resultRow = result[0];

      if (!resultRow) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to publish project",
        });
      }

      await assignProjectBoundary(resultRow.id);

      void notifyNewSubmission({
        kind: "project",
        author: { email: ctx.user.email, username: ctx.user.username },
        projectId: resultRow.id,
        projectName: resultRow.name,
        countryCode: resultRow.countryCode ?? null,
        lat: resultRow.lat,
        lng: resultRow.lng,
      });

      return {
        id: resultRow.id,
        exists: false,
      };
    } catch (error) {
      // Re-throw TRPCErrors as-is to preserve error codes and messages
      if (error instanceof TRPCError) {
        throw error;
      }
      // Log and wrap unexpected errors
      console.error("Error publishing project:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to publish project",
      });
    }
  }),

  deleteProject: loggedInProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const userId = ctx.user.id;

        // Use transaction to ensure atomic deletion of project and overlays
        // This prevents partial deletes and race conditions
        const projectOverlays = await db.transaction(async (tx) => {
          // Get project to check permissions and status
          const project = await tx
            .select({
              id: projects.id,
              ownerId: projects.ownerId,
              status: projects.status,
              name: projects.name,
            })
            .from(projects)
            .where(eq(projects.id, input.id))
            .limit(1);

          const projectRecord = project[0];

          if (!projectRecord) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
          }

          // Only owner can delete their own project
          if (projectRecord.ownerId !== userId) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Not authorized to delete this project",
            });
          }

          // Only pending projects can be deleted
          if (projectRecord.status !== "pending") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Can only delete pending projects",
            });
          }

          // Get all overlays for this project to delete their images later
          const overlaysToDelete = await tx
            .select({
              id: overlays.id,
              filename: overlays.filename,
            })
            .from(overlays)
            .where(eq(overlays.projectId, input.id));

          // Overlays first to satisfy the foreign key constraint
          if (overlaysToDelete.length > 0) {
            await tx.delete(overlays).where(eq(overlays.projectId, input.id));
          }

          await tx.delete(projects).where(eq(projects.id, input.id));

          return overlaysToDelete;
        });

        // Delete all overlay images AFTER transaction commits
        // This prevents holding transaction open during slow I/O operations
        // If image deletion fails, DB is still consistent (orphaned images are less critical)
        for (const overlay of projectOverlays) {
          try {
            await deleteLocalImages(overlay.filename, "both");
            console.log(`Deleted local images for overlay ${overlay.id}`);
          } catch (error) {
            console.error(`Failed to delete images for overlay ${overlay.id}:`, error);
          }
        }

        return { success: true };
      } catch (error) {
        console.error("Error deleting project:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to delete project" });
      }
    }),

  // Get a project by ID (used by vector tile click handler).
  // Returns approved projects to everyone; also returns the project to its owner regardless of status.
  getById: publicProcedure.input(z.object({ id: z.uuid() })).query(async ({ input, ctx }) => {
    try {
      const statusCondition = ctx.user
        ? or(eq(projects.status, "approved"), eq(projects.ownerId, ctx.user.id))
        : eq(projects.status, "approved");

      const rows = await db
        .select({
          ...PROJECT_COLUMNS,
          importSource: importSources,
          ownerUsername: users.username,
        })
        .from(projects)
        .leftJoin(importSources, eq(importSources.id, projects.importSourceId))
        .leftJoin(users, eq(users.id, projects.ownerId))
        .where(and(eq(projects.id, input.id), statusCondition))
        .limit(1);

      const project = rows[0];
      if (!project) return null;

      // Attach the render the caller is allowed to know about: approved, or their own pending.
      // Another user's pending render is never returned. The frontend decides whether to display a
      // pending render based on the live map mode, so this stays mode-independent.
      const renderRows = await db
        .select({
          filename: overlays.filename,
          caption: overlays.caption,
          status: overlays.status,
        })
        .from(overlays)
        .where(
          and(
            eq(overlays.projectId, input.id),
            eq(overlays.kind, "render"),
            buildOverlayVisibilityCondition(ctx.user, "edit"),
          ),
        )
        .orderBy(
          sql`CASE WHEN ${overlays.status} = 'approved' THEN 0 ELSE 1 END`,
          desc(overlays.updatedAt),
        )
        .limit(1);

      // Full administrative breadcrumb (deepest boundary up to the country) for the detail panel.
      const boundaryPath = project.adminBoundaryId
        ? await resolveBoundaryPath(project.adminBoundaryId)
        : [];

      return { ...project, render: renderRows[0] ?? null, boundaryPath };
    } catch (error) {
      console.error("Error fetching project by id:", error);
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to fetch project" });
    }
  }),

  // Get user's contributions including owned projects, projects with user-authored overlays, and projects with user's change requests
  getUsersContributions: loggedInProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).optional().default(50),
        cursor: z.uuid().optional(),
        sortBy: z.enum(["createdAt", "updatedAt"]).optional().default("updatedAt"),
      }),
    )
    .query(async ({ input, ctx }) => {
      try {
        const sortColumn = input.sortBy === "createdAt" ? projects.createdAt : projects.updatedAt;

        const paginationConditions = await buildPaginationConditions(
          { cursor: input.cursor },
          sortColumn,
        );

        const whereConditions = [eq(projects.ownerId, ctx.user.id), ...paginationConditions];

        const ownedProjects = await buildProjectWithLocationQuery(db)
          .where(and(...whereConditions))
          .orderBy(sql`${sortColumn} DESC`, sql`${projects.id} DESC`)
          .limit(input.limit + 1);

        // Helper: project is not owned by the user (handles null ownerId for imported projects)
        const notOwnedByUser = or(isNull(projects.ownerId), ne(projects.ownerId, ctx.user.id));

        // Get project IDs where user has authored overlays (but doesn't own the project)
        const contributedProjectIdsFromOverlays = await db
          .selectDistinct({ projectId: overlays.projectId })
          .from(overlays)
          .innerJoin(projects, eq(overlays.projectId, projects.id))
          .where(and(eq(overlays.authorId, ctx.user.id), notOwnedByUser))
          .limit(input.limit);

        // Get project IDs where user has submitted change requests for overlays (but doesn't own the project)
        const contributedProjectIdsFromOverlayChangeRequests = await db
          .selectDistinct({
            projectId: sql<string>`${overlays.projectId}`.as("projectId"),
          })
          .from(changeRequests)
          .innerJoin(overlays, eq(changeRequests.entityId, overlays.id))
          .innerJoin(projects, eq(overlays.projectId, projects.id))
          .where(
            and(
              eq(changeRequests.requestedBy, ctx.user.id),
              eq(changeRequests.entityType, "overlay"),
              notOwnedByUser,
            ),
          )
          .limit(input.limit);

        // Get project IDs where user has submitted change requests directly to projects (but doesn't own the project)
        const contributedProjectIdsFromProjectChangeRequests = await db
          .selectDistinct({
            projectId: changeRequests.entityId,
          })
          .from(changeRequests)
          .innerJoin(projects, eq(changeRequests.entityId, projects.id))
          .where(
            and(
              eq(changeRequests.requestedBy, ctx.user.id),
              eq(changeRequests.entityType, "project"),
              notOwnedByUser,
            ),
          )
          .limit(input.limit);

        // Combine and deduplicate project IDs from all sources
        const allContributedProjectIds = [
          ...contributedProjectIdsFromOverlays.map((p) => p.projectId),
          ...contributedProjectIdsFromOverlayChangeRequests.map((p) => p.projectId),
          ...contributedProjectIdsFromProjectChangeRequests.map((p) => p.projectId),
        ];
        const contributedProjectIds = [...new Set(allContributedProjectIds)].filter(
          (id) => id !== null,
        ); // Filter out nulls and assert non-null type

        const contributedProjects =
          contributedProjectIds.length > 0
            ? await buildProjectWithLocationQuery(db)
                .where(inArray(projects.id, contributedProjectIds))
                .orderBy(sql`${projects.updatedAt} DESC`)
            : [];

        const hasMoreOwned = ownedProjects.length > input.limit;
        const paginatedOwnedProjects = hasMoreOwned
          ? ownedProjects.slice(0, input.limit)
          : ownedProjects;

        const allProjects = [...paginatedOwnedProjects, ...contributedProjects];

        const projectIds = allProjects.map((project) => project.id);
        let projectOverlays: Awaited<ReturnType<typeof buildOverlayModerationQuery>> = [];

        if (projectIds.length > 0) {
          // For projects owned by user, get all overlays
          // For contributed projects, get user's overlays OR overlays with user's change requests
          const ownedProjectIds = ownedProjects.map((project) => project.id);

          // Get overlay IDs where user has submitted change requests
          const overlayIdsWithChangeRequests =
            contributedProjectIds.length > 0
              ? await db
                  .selectDistinct({ overlayId: changeRequests.entityId })
                  .from(changeRequests)
                  .where(
                    and(
                      eq(changeRequests.requestedBy, ctx.user.id),
                      eq(changeRequests.entityType, "overlay"),
                    ),
                  )
              : [];

          const overlayIdsWithChanges = overlayIdsWithChangeRequests.map(
            (overlay) => overlay.overlayId,
          );

          if (ownedProjectIds.length > 0 && contributedProjectIds.length > 0) {
            // Both owned and contributed projects exist
            projectOverlays = await buildOverlayModerationQuery(db)
              .where(
                or(
                  // All overlays for user's own projects
                  inArray(overlays.projectId, ownedProjectIds),
                  // For contributed projects: user's overlays OR overlays with user's change requests
                  and(
                    inArray(overlays.projectId, contributedProjectIds),
                    or(
                      eq(overlays.authorId, ctx.user.id),
                      overlayIdsWithChanges.length > 0
                        ? inArray(overlays.id, overlayIdsWithChanges)
                        : sql`false`,
                    ),
                  ),
                ),
              )
              .orderBy(overlays.updatedAt);
          } else if (ownedProjectIds.length > 0) {
            // Only owned projects exist
            projectOverlays = await buildOverlayModerationQuery(db)
              .where(inArray(overlays.projectId, ownedProjectIds))
              .orderBy(overlays.updatedAt);
          } else if (contributedProjectIds.length > 0) {
            // Only contributed projects exist
            projectOverlays = await buildOverlayModerationQuery(db)
              .where(
                and(
                  inArray(overlays.projectId, contributedProjectIds),
                  or(
                    eq(overlays.authorId, ctx.user.id),
                    overlayIdsWithChanges.length > 0
                      ? inArray(overlays.id, overlayIdsWithChanges)
                      : sql`false`,
                  ),
                ),
              )
              .orderBy(overlays.updatedAt);
          }
        }

        const projectsWithOverlays = allProjects.map((project) => {
          const projectOverlaysList = projectOverlays.filter(
            (overlay) => overlay.projectId === project.id,
          );
          return {
            ...project,
            tags: project.tags ?? [],
            overlays: projectOverlaysList,
            overlayIds: projectOverlaysList.map((overlay) => overlay.id),
          };
        });

        // Build pagination response using shared helper (only for owned projects, as contributed are not paginated)
        const paginationResponse = buildPaginationResponse(ownedProjects, input.limit);

        return {
          projects: projectsWithOverlays,
          pagination: paginationResponse.pagination,
        };
      } catch (error) {
        console.error("Error fetching all projects:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch all projects",
        });
      }
    }),
});
