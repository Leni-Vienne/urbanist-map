import { publicProcedure, loggedInProcedure, router } from "../trpc";
import * as z from "zod"; // Smaller bundle compared to 'import { z } from 'zod';
import { projects, cities, overlays, changeRequests } from "../db/schema";
import { eq, sql, and, or, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../database";
import {
  buildProjectWithLocationQuery,
  buildOverlayModerationQuery,
  buildPaginationConditions,
  buildPaginationResponse,
  isUserBlocked,
} from "../db/helpers";
import {
  checkPendingLimitForNewContribution,
  checkTotalContributionLimit,
} from "../db/contributionHelpers";
import { deleteLocalImages } from "../lib/imageCleanup";
import { projectSchema } from "@shared/validation/schemas";

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

      // Validate city exists
      if (input.cityId) {
        const city = await db.select().from(cities).where(eq(cities.id, input.cityId)).limit(1);
        if (city.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "City not found" });
        }
      }

      // Check contribution limits
      if (!input.id) {
        // Only check total limit for NEW projects (updates don't increase count)
        await checkTotalContributionLimit(ctx.user.id);
      }

      // Check pending contribution limit for new projects
      await checkPendingLimitForNewContribution(ctx.user.id, input.id);

      // Build data object with proper null handling for dates and precision
      const data = {
        ...input,
        ownerId: ctx.user.id,
        cityId: input.cityId,
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
        // Bbox diagonal in meters — used to exclude large-geometry projects from the cluster GeoJSON source
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
              cityId: data.cityId,
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

          // Delete all overlays from database first (foreign key constraint)
          if (overlaysToDelete.length > 0) {
            await tx.delete(overlays).where(eq(overlays.projectId, input.id));
          }

          // Delete project from database
          await tx.delete(projects).where(eq(projects.id, input.id));

          // Return overlays to delete images after transaction commits
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

  // Get projects by city
  getCityProjects: publicProcedure
    .input(
      z.object({
        cityId: z.number(),
        limit: z.number().min(1).max(100).optional().default(20),
        mode: z.enum(["view", "edit", "moderation"]).optional().default("view"), // Map viewing mode
      }),
    )
    .query(async ({ input, ctx }) => {
      try {
        // SECURITY: Reject moderation mode for unauthenticated users
        if (input.mode === "moderation" && !ctx.user) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Authentication required for moderation mode",
          });
        }

        // Build where conditions based on user authentication and mode
        // In edit mode, show approved OR user's own contributions (any status)
        // In moderation mode, show approved OR pending from all users
        // In view mode or anonymous, only show approved
        const whereConditions = [eq(projects.cityId, input.cityId)];

        if (input.mode === "edit" && ctx.user) {
          // Edit mode + logged in: users can see approved projects OR their own contributions (any status)
          whereConditions.push(
            sql`(${projects.status} = 'approved' OR ${projects.ownerId} = ${ctx.user.id})`,
          );
        } else if (input.mode === "moderation" && ctx.user) {
          // Moderation mode + logged in: see approved OR pending projects (for review)
          whereConditions.push(
            sql`(${projects.status} = 'approved' OR ${projects.status} = 'pending')`,
          );
        } else {
          // View mode or anonymous: only see approved projects
          whereConditions.push(eq(projects.status, "approved"));
        }

        const projectsInCity = await db
          .select({
            id: projects.id,
            name: projects.name,
            description: projects.description,
            status: projects.status, // Include status to distinguish pending/approved/rejected
            ownerId: projects.ownerId,
            cityId: projects.cityId,
            lat: projects.lat,
            lng: projects.lng,
            geometry: sql<GeoJSON.GeometryCollection | null>`CASE WHEN ${projects.geometry} IS NULL THEN NULL ELSE ST_AsGeoJSON(${projects.geometry})::json END`,
            proposalDate: projects.proposalDate,
            proposalDatePrecision: projects.proposalDatePrecision,
            startDate: projects.startDate,
            startDatePrecision: projects.startDatePrecision,
            endDate: projects.endDate,
            endDatePrecision: projects.endDatePrecision,
            sourceUrl: projects.sourceUrl,
            tags: projects.tags,
            createdAt: projects.createdAt,
            updatedAt: projects.updatedAt,
            // Count approved overlays OR user's own overlays (only in edit mode)
            overlayCount:
              ctx.user && input.mode !== "view"
                ? sql<number>`COUNT(CASE WHEN ${overlays.status} = 'approved' OR ${overlays.authorId} = ${ctx.user.id} THEN 1 END)::int`
                : sql<number>`COUNT(CASE WHEN ${overlays.status} = 'approved' THEN 1 END)::int`,
            city: cities,
          })
          .from(projects)
          .innerJoin(cities, eq(projects.cityId, cities.id))
          .leftJoin(overlays, eq(overlays.projectId, projects.id))
          .where(and(...whereConditions))
          .groupBy(
            projects.id,
            projects.name,
            projects.description,
            projects.status, // Include status in groupBy
            projects.ownerId,
            projects.cityId,
            projects.lat,
            projects.lng,
            projects.geometry,
            projects.proposalDate,
            projects.proposalDatePrecision,
            projects.startDate,
            projects.startDatePrecision,
            projects.endDate,
            projects.endDatePrecision,
            projects.sourceUrl,
            projects.tags,
            projects.createdAt,
            projects.updatedAt,
            cities.id,
            cities.name,
            cities.countryCode,
            cities.coordinates,
          )
          .orderBy(sql`${projects.createdAt} DESC`)
          .limit(input.limit);

        return projectsInCity;
      } catch (error) {
        console.error("Error fetching projects by city:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch projects by city",
        });
      }
    }),

  // Get a single approved project by ID (used by vector tile click handler)
  getById: publicProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input }) => {
    try {
      const rows = await db
        .select({
          id: projects.id,
          name: projects.name,
          description: projects.description,
          status: projects.status,
          ownerId: projects.ownerId,
          cityId: projects.cityId,
          lat: projects.lat,
          lng: projects.lng,
          geometry: sql<GeoJSON.GeometryCollection | null>`CASE WHEN ${projects.geometry} IS NULL THEN NULL ELSE ST_AsGeoJSON(${projects.geometry})::json END`,
          proposalDate: projects.proposalDate,
          proposalDatePrecision: projects.proposalDatePrecision,
          startDate: projects.startDate,
          startDatePrecision: projects.startDatePrecision,
          endDate: projects.endDate,
          endDatePrecision: projects.endDatePrecision,
          sourceUrl: projects.sourceUrl,
          tags: projects.tags,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
          city: cities,
        })
        .from(projects)
        .innerJoin(cities, eq(projects.cityId, cities.id))
        .where(and(eq(projects.id, input.id), eq(projects.status, "approved")))
        .limit(1);

      return rows[0] ?? null;
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
        cursor: z.string().uuid().optional(),
        sortBy: z.enum(["createdAt", "updatedAt"]).optional().default("updatedAt"),
        cityId: z.number().optional(),
        countryCode: z.string().length(3).optional(),
        includeCityProjects: z.boolean().optional(), // When true + cityId provided, return ALL city projects
      }),
    )
    .query(async ({ input, ctx }) => {
      try {
        // NEW: If includeCityProjects + cityId provided, return ALL city projects in UserContribution format
        if (input.includeCityProjects && input.cityId) {
          // Query ALL projects in the city (approved OR user's pending)
          const cityProjects = await buildProjectWithLocationQuery(db)
            .where(
              and(
                eq(projects.cityId, input.cityId),
                or(
                  eq(projects.status, "approved"),
                  and(eq(projects.status, "pending"), eq(projects.ownerId, ctx.user.id)),
                ),
              ),
            )
            .orderBy(sql`${projects.updatedAt} DESC`)
            .limit(input.limit);

          const projectIds = cityProjects.map((p) => p.id);
          let projectOverlays: Awaited<ReturnType<typeof buildOverlayModerationQuery>> = [];

          if (projectIds.length > 0) {
            // Get overlays for these projects (approved OR user's own)
            projectOverlays = await buildOverlayModerationQuery(db)
              .where(
                and(
                  inArray(overlays.projectId, projectIds),
                  or(eq(overlays.status, "approved"), eq(overlays.authorId, ctx.user.id)),
                ),
              )
              .orderBy(overlays.updatedAt);
          }

          const projectsWithOverlays = cityProjects.map((project) => {
            const projectOverlaysList = projectOverlays.filter(
              (overlay) => overlay.projectId === project.id,
            );
            return Object.assign({}, project, {
              overlays: projectOverlaysList,
              overlayCount: projectOverlaysList.length,
            });
          });

          return {
            projects: projectsWithOverlays,
            pagination: { hasMore: false, nextCursor: null }, // No pagination for city projects
          };
        }

        // EXISTING: Return user's own contributions
        const sortColumn = input.sortBy === "createdAt" ? projects.createdAt : projects.updatedAt;

        // Build pagination conditions using shared helper
        const paginationConditions = await buildPaginationConditions(
          { cityId: input.cityId, countryCode: input.countryCode, cursor: input.cursor },
          sortColumn,
        );

        const whereConditions = [eq(projects.ownerId, ctx.user.id), ...paginationConditions];

        const ownedProjects = await buildProjectWithLocationQuery(db)
          .where(and(...whereConditions))
          .orderBy(sql`${sortColumn} DESC`)
          .limit(input.limit + 1);

        // Get project IDs where user has authored overlays (but doesn't own the project)
        const contributedProjectIdsFromOverlays = await db
          .selectDistinct({ projectId: overlays.projectId })
          .from(overlays)
          .innerJoin(projects, eq(overlays.projectId, projects.id))
          .where(
            and(
              eq(overlays.authorId, ctx.user.id),
              sql`${projects.ownerId} != ${ctx.user.id}`, // Exclude projects already owned by user
            ),
          )
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
              sql`${projects.ownerId} != ${ctx.user.id}`, // Exclude projects already owned by user
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
              sql`${projects.ownerId} != ${ctx.user.id}`, // Exclude projects already owned by user
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
          return Object.assign({}, project, {
            overlays: projectOverlaysList,
            overlayCount: projectOverlaysList.length,
          });
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
