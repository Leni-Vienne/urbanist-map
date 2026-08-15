import { publicProcedure, loggedInProcedure, router } from "../trpc";
import * as z from "zod"; // Smaller bundle compared to 'import { z } from 'zod';
import {
  projects,
  overlays,
  changeRequests,
  importSources,
  users,
  deletedProjects,
} from "../db/schema";
import { eq, sql, and, or, inArray, exists, desc } from "drizzle-orm";
import { union } from "drizzle-orm/pg-core";
import { TRPCError } from "@trpc/server";
import { db } from "../database";
import {
  buildProjectWithLocationQuery,
  buildOverlayModerationQuery,
  buildOverlayVisibilityCondition,
  isUserBlocked,
  generateUniqueProjectSlug,
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
import { scalarGeometrySizeMSql } from "../db/geometrySize";

function normalizePrecisionForStorage(
  date: Date | null | undefined,
  precision: "year" | "month" | "day" | null | undefined,
) {
  if (!date) {
    return null;
  }

  return precision ?? "day";
}

function requestLanguageCode(acceptLanguage: string | undefined): string {
  const language = acceptLanguage?.split(",")[0]?.split(";")[0]?.trim().split("-")[0];
  return language && /^[a-z]{2,3}$/i.test(language) ? language.toLowerCase() : "en";
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

      // ST_MakeValid normalizes the client-drawn shape on the way in so a self-intersecting
      // polygon (bowtie) or malformed ring ("nested shell") is stored valid rather than as-drawn.
      // No-op for lines/points, which are always valid.
      const geometryExpr = input.geometry
        ? sql`ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(input.geometry)}), 4326))`
        : null;

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
        geometry: geometryExpr,
        geometrySizeM: geometryExpr ? scalarGeometrySizeMSql(geometryExpr) : null,
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
          return;
        }
      }

      // Insert new project (with provided ID or auto-generated UUID). The id is generated up front
      // so the permanent, uuid-derived slug can be computed before the insert. The slug is never
      // regenerated on later edits (the update path above leaves it untouched) to keep URLs stable.
      const newProjectId = input.id ?? crypto.randomUUID();
      const slug = await generateUniqueProjectSlug({ name: data.name, id: newProjectId });
      const result = await db
        .insert(projects)
        .values({ ...data, id: newProjectId, slug })
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
        countryCode: resultRow.countryCode,
        lat: resultRow.lat,
        lng: resultRow.lng,
      });
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
          adminBoundaryId: projects.adminBoundaryId,
          slug: projects.slug,
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
      const { adminBoundaryId, ...projectData } = project;
      const boundaryPath = adminBoundaryId ? await resolveBoundaryPath(adminBoundaryId) : [];

      return { ...projectData, render: renderRows[0] ?? null, boundaryPath };
    } catch (error) {
      console.error("Error fetching project by id:", error);
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to fetch project" });
    }
  }),

  // Resolve a project by its permanent slug for the /project/:slug deep link. Public: returns
  // approved projects to everyone (also the owner's own, regardless of status, so an owner opening
  // their pending project's link still lands on it). When no live project matches, falls back to a
  // tombstone (deleted project) so the SPA can center the map on the last known location.
  getBySlug: publicProcedure.input(z.object({ slug: z.string() })).query(async ({ input, ctx }) => {
    try {
      const statusCondition = ctx.user
        ? or(eq(projects.status, "approved"), eq(projects.ownerId, ctx.user.id))
        : eq(projects.status, "approved");

      const rows = await db
        .select({
          ...PROJECT_COLUMNS,
          adminBoundaryId: projects.adminBoundaryId,
          slug: projects.slug,
          importSource: importSources,
          ownerUsername: users.username,
        })
        .from(projects)
        .leftJoin(importSources, eq(importSources.id, projects.importSourceId))
        .leftJoin(users, eq(users.id, projects.ownerId))
        .where(and(eq(projects.slug, input.slug), statusCondition))
        .limit(1);

      const project = rows[0];
      if (project) {
        const renderRows = await db
          .select({
            filename: overlays.filename,
            caption: overlays.caption,
            status: overlays.status,
          })
          .from(overlays)
          .where(
            and(
              eq(overlays.projectId, project.id),
              eq(overlays.kind, "render"),
              buildOverlayVisibilityCondition(ctx.user, "edit"),
            ),
          )
          .orderBy(
            sql`CASE WHEN ${overlays.status} = 'approved' THEN 0 ELSE 1 END`,
            desc(overlays.updatedAt),
          )
          .limit(1);

        const { adminBoundaryId, ...projectData } = project;
        const boundaryPath = adminBoundaryId ? await resolveBoundaryPath(adminBoundaryId) : [];

        return {
          found: true as const,
          project: { ...projectData, render: renderRows[0] ?? null, boundaryPath },
        };
      }

      const tombstones = await db
        .select({
          lat: deletedProjects.lat,
          lng: deletedProjects.lng,
        })
        .from(deletedProjects)
        .where(eq(deletedProjects.slug, input.slug))
        .limit(1);

      const tombstone = tombstones[0];
      if (tombstone) {
        return {
          found: false as const,
          gone: true as const,
          lat: tombstone.lat,
          lng: tombstone.lng,
        };
      }

      return { found: false as const, gone: false as const };
    } catch (error) {
      console.error("Error fetching project by slug:", error);
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to fetch project" });
    }
  }),

  // Get every project the user owns or has contributed to through an overlay or change request.
  getUsersContributions: loggedInProcedure.query(async ({ ctx }) => {
    try {
      const contributionProjectRows = await union(
        db.select({ id: projects.id }).from(projects).where(eq(projects.ownerId, ctx.user.id)),
        db
          .select({ id: projects.id })
          .from(overlays)
          .innerJoin(projects, eq(projects.id, overlays.projectId))
          .where(eq(overlays.authorId, ctx.user.id)),
        db
          .select({ id: projects.id })
          .from(changeRequests)
          .innerJoin(projects, eq(projects.id, changeRequests.entityId))
          .where(
            and(
              eq(changeRequests.requestedBy, ctx.user.id),
              eq(changeRequests.entityType, "project"),
            ),
          ),
        db
          .select({ id: projects.id })
          .from(changeRequests)
          .innerJoin(overlays, eq(overlays.id, changeRequests.entityId))
          .innerJoin(projects, eq(projects.id, overlays.projectId))
          .where(
            and(
              eq(changeRequests.requestedBy, ctx.user.id),
              eq(changeRequests.entityType, "overlay"),
            ),
          ),
      );
      const candidateProjectIds = contributionProjectRows.map((row) => row.id);
      const requestLanguage = requestLanguageCode(ctx.hono.req.header("Accept-Language"));
      const allProjects =
        candidateProjectIds.length > 0
          ? await buildProjectWithLocationQuery(db, requestLanguage)
              .where(inArray(projects.id, candidateProjectIds))
              .orderBy(sql`${projects.updatedAt} DESC`, sql`${projects.id} DESC`)
          : [];

      const projectIds = allProjects.map((project) => project.id);
      let projectOverlays: Awaited<ReturnType<typeof buildOverlayModerationQuery>> = [];

      if (projectIds.length > 0) {
        const ownedProjectIds = allProjects
          .filter((project) => project.ownerId === ctx.user.id)
          .map((project) => project.id);
        const userOverlayChangeRequest = db
          .select({ id: changeRequests.id })
          .from(changeRequests)
          .where(
            and(
              eq(changeRequests.requestedBy, ctx.user.id),
              eq(changeRequests.entityType, "overlay"),
              eq(changeRequests.entityId, overlays.id),
            ),
          );
        const visibleOverlayConditions = [
          eq(overlays.authorId, ctx.user.id),
          exists(userOverlayChangeRequest),
        ];
        if (ownedProjectIds.length > 0) {
          visibleOverlayConditions.push(inArray(overlays.projectId, ownedProjectIds));
        }

        projectOverlays = await buildOverlayModerationQuery(db)
          .where(and(inArray(overlays.projectId, projectIds), or(...visibleOverlayConditions)))
          .orderBy(overlays.updatedAt);
      }

      const overlaysByProjectId = new Map<string, typeof projectOverlays>();
      for (const overlay of projectOverlays) {
        if (!overlay.projectId) continue;
        const grouped = overlaysByProjectId.get(overlay.projectId) ?? [];
        grouped.push(overlay);
        overlaysByProjectId.set(overlay.projectId, grouped);
      }

      const projectsWithOverlays = allProjects.map((project) => {
        const projectOverlaysList = overlaysByProjectId.get(project.id) ?? [];
        return Object.assign(project, {
          tags: project.tags ?? [],
          overlays: projectOverlaysList,
          overlayIds: projectOverlaysList.map((overlay) => overlay.id),
        });
      });

      return { projects: projectsWithOverlays };
    } catch (error) {
      console.error("Error fetching all projects:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch all projects",
      });
    }
  }),
});
