import { publicProcedure, loggedInProcedure, router } from "../trpc";
import * as z from "zod"; // smaller bundle compared to 'import { z } from 'zod';
import { projects, cities, overlays, changeRequests } from "../db/schema";
import { eq, sql, and, or, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../database";
import {
  buildProjectWithLocationQuery,
  buildOverlayModerationQuery,
  buildPaginationConditions,
  buildPaginationResponse,
} from "../db/helpers";
import {
  checkPendingLimitForNewContribution,
  checkTotalContributionLimit,
} from "../db/contributionHelpers";
import { deleteLocalImages } from "../lib/imageCleanup";
import { projectSchema } from "@shared/validation/schemas";

// AI : Nearby search radius configuration
const NEARBY_SEARCH_RADIUS_METERS = 10 * 1000; // 10km

// AI : Use shared project schema for validation
const publishProjectSchema = projectSchema;

export const projectRouter = router({
  publishProject: loggedInProcedure.input(publishProjectSchema).mutation(async ({ input, ctx }) => {
    try {
      // AI : Validate city exists
      if (input.cityId) {
        const city = await db.select().from(cities).where(eq(cities.id, input.cityId)).limit(1);
        if (city.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "City not found" });
        }
      }

      // AI : Check contribution limits
      if (!input.id) {
        // Only check total limit for NEW projects (updates don't increase count)
        await checkTotalContributionLimit(ctx.user.id);
      }

      // AI : Check pending contribution limit for new projects
      await checkPendingLimitForNewContribution(ctx.user.id, input.id);

      // AI : Build data object with proper null handling for dates
      const data = {
        ...input,
        ownerId: ctx.user.id,
        cityId: input.cityId,
        proposalDate: input.proposalDate ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        sourceUrl: input.sourceUrl,
        latestUpdateOn: input.latestUpdateOn ? new Date(input.latestUpdateOn) : null,
        // AI : Set center coordinate for all projects using PostGIS
        centerCoordinate: sql`ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)`,
      };

      if (input.id) {
        // AI : Capture projectId in const for type narrowing inside transaction
        const projectId = input.id;

        // AI : Use transaction to prevent race conditions between validation and update
        // AI : This ensures status/ownership checks remain valid when update executes
        const result = await db.transaction(async (tx) => {
          // AI : Check if project exists and validate permissions
          const existingProject = await tx
            .select()
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

          if (existingProject.length === 0) {
            return null;
          }

          const project = existingProject[0];

          // AI : Security check - only owner can modify their project
          if (project.ownerId !== ctx.user.id) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You can only modify your own projects",
            });
          }

          // AI : Workflow check - approved projects must use change request system
          if (project.status === "approved") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Cannot directly modify approved projects. Please use the change request system to suggest modifications.",
            });
          }

          // AI : Allow updates only for pending/rejected projects owned by user
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
              startDate: data.startDate,
              endDate: data.endDate,
              sourceUrl: data.sourceUrl,
              latestUpdateOn: data.latestUpdateOn,
              version: sql`${projects.version} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(projects.id, projectId))
            .returning();

          return updateResult[0];
        });

        if (result) {
          return {
            success: true,
            id: result.id,
            exists: true,
          };
        }
      }

      // AI : Insert new project (with provided ID or auto-generated UUID)
      const result = await db
        .insert(projects)
        .values(input.id ? { ...data, id: input.id } : data)
        .returning();

      return {
        success: true,
        id: result[0].id,
        exists: false,
      };
    } catch (error) {
      // AI : Re-throw TRPCErrors as-is to preserve error codes and messages
      if (error instanceof TRPCError) {
        throw error;
      }
      // AI : Log and wrap unexpected errors
      console.error("Error publishing project:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to publish project",
        cause: error,
      });
    }
  }),

  deleteProject: loggedInProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const userId = ctx.user?.id;
        if (!userId) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Must be logged in to delete project",
          });
        }

        // AI : Use transaction to ensure atomic deletion of project and overlays
        // AI : This prevents partial deletes and race conditions
        const projectOverlays = await db.transaction(async (tx) => {
          // AI : Get project to check permissions and status
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

          if (project.length === 0) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
          }

          // AI : Only owner can delete their own project
          if (project[0].ownerId !== userId) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Not authorized to delete this project",
            });
          }

          // AI : Only pending projects can be deleted
          if (project[0].status !== "pending") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Can only delete pending projects",
            });
          }

          // AI : Get all overlays for this project to delete their images later
          const overlaysToDelete = await tx
            .select({
              id: overlays.id,
              filename: overlays.filename,
            })
            .from(overlays)
            .where(eq(overlays.projectId, input.id));

          // AI : Delete all overlays from database first (foreign key constraint)
          if (overlaysToDelete.length > 0) {
            await tx.delete(overlays).where(eq(overlays.projectId, input.id));
          }

          // AI : Delete project from database
          await tx.delete(projects).where(eq(projects.id, input.id));

          // AI : Return overlays to delete images after transaction commits
          return overlaysToDelete;
        });

        // AI : Delete all overlay images AFTER transaction commits
        // AI : This prevents holding transaction open during slow I/O operations
        // AI : If image deletion fails, DB is still consistent (orphaned images are less critical)
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

  // AI : Get projects with overlays within 100km of camera center
  getProjectsNearLocation: loggedInProcedure
    .input(
      z.object({
        lat: z.number(),
        lng: z.number(),
      }),
    )
    .query(async ({ input, ctx }) => {
      try {
        const { lat, lng } = input;
        const userId = ctx.user.id;

        // AI : Find projects within radius that are either approved OR pending and owned by user
        const nearbyProjects = await db
          .select({
            id: projects.id,
            name: projects.name,
            version: projects.version,
            description: projects.description,
            status: projects.status,
            ownerId: projects.ownerId,
            cityId: projects.cityId,
            proposalDate: projects.proposalDate,
            startDate: projects.startDate,
            endDate: projects.endDate,
            sourceUrl: projects.sourceUrl,
            latestUpdateOn: projects.latestUpdateOn,
            createdAt: projects.createdAt,
            updatedAt: projects.updatedAt,
            overlayCount: sql<number>`COUNT(${overlays.id})::int`,
            city: cities,
          })
          .from(projects)
          .innerJoin(cities, eq(projects.cityId, cities.id))
          .innerJoin(overlays, eq(overlays.projectId, projects.id))
          .where(
            and(
              or(
                and(eq(projects.status, "approved"), eq(overlays.status, "approved")),
                and(eq(projects.status, "pending"), eq(projects.ownerId, userId)),
              ),
              sql`${overlays.centroid} IS NOT NULL`,
              sql`ST_DWithin(
              ${overlays.centroid},
              ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
              ${NEARBY_SEARCH_RADIUS_METERS}
            )`,
            ),
          )
          .groupBy(
            projects.id,
            projects.name,
            projects.version,
            projects.status,
            projects.description,
            projects.ownerId,
            projects.cityId,
            projects.proposalDate,
            projects.startDate,
            projects.endDate,
            projects.sourceUrl,
            projects.latestUpdateOn,
            projects.createdAt,
            projects.updatedAt,
            cities.id,
            cities.name,
            cities.countryCode,
            cities.coordinates,
          );

        return { projects: nearbyProjects };
      } catch (error) {
        console.error("Error fetching nearby projects:", error);
        throw new Error("Failed to fetch nearby projects", { cause: error });
      }
    }),

  // AI : Get projects by city
  getCityProjects: publicProcedure
    .input(
      z.object({
        cityId: z.uuid(),
        limit: z.number().min(1).max(100).optional().default(20),
        mode: z.enum(["view", "edit", "moderation"]).optional().default("view"), // AI : Map viewing mode
      }),
    )
    .query(async ({ input, ctx }) => {
      try {
        // AI : Build where conditions based on user authentication and mode
        // AI : In edit mode, show approved OR user's own contributions (any status)
        // AI : In moderation mode, show approved OR pending from all users
        // AI : In view mode or anonymous, only show approved
        const whereConditions = [eq(projects.cityId, input.cityId)];

        if (input.mode === "edit" && ctx.user) {
          // AI : Edit mode + logged in: users can see approved projects OR their own contributions (any status)
          whereConditions.push(
            sql`(${projects.status} = 'approved' OR ${projects.ownerId} = ${ctx.user.id})`,
          );
        } else if (input.mode === "moderation" && ctx.user) {
          // AI : Moderation mode + logged in: see approved OR pending projects (for review)
          whereConditions.push(
            sql`(${projects.status} = 'approved' OR ${projects.status} = 'pending')`,
          );
        } else {
          // AI : View mode or anonymous: only see approved projects
          whereConditions.push(eq(projects.status, "approved"));
        }

        const projectsInCity = await db
          .select({
            id: projects.id,
            name: projects.name,
            description: projects.description,
            status: projects.status, // AI : Include status to distinguish pending/approved/rejected
            ownerId: projects.ownerId,
            cityId: projects.cityId,
            lat: projects.lat,
            lng: projects.lng,
            proposalDate: projects.proposalDate,
            startDate: projects.startDate,
            endDate: projects.endDate,
            sourceUrl: projects.sourceUrl,
            latestUpdateOn: projects.latestUpdateOn,
            createdAt: projects.createdAt,
            updatedAt: projects.updatedAt,
            // AI : Count approved overlays OR user's own overlays (only in edit mode)
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
            projects.status, // AI : Include status in groupBy
            projects.ownerId,
            projects.cityId,
            projects.lat,
            projects.lng,
            projects.proposalDate,
            projects.startDate,
            projects.endDate,
            projects.sourceUrl,
            projects.latestUpdateOn,
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
        throw new Error("Failed to fetch projects by city", { cause: error });
      }
    }),

  // AI : Get user's contributions including owned projects, projects with user-authored overlays, and projects with user's change requests
  getUsersContributions: loggedInProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).optional().default(50),
        cursor: z.string().uuid().optional(),
        sortBy: z.enum(["createdAt", "updatedAt"]).optional().default("updatedAt"),
        cityId: z.string().uuid().optional(),
        countryCode: z.string().length(3).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      try {
        const sortColumn = input.sortBy === "createdAt" ? projects.createdAt : projects.updatedAt;

        // AI : Build pagination conditions using shared helper
        const paginationConditions = await buildPaginationConditions(
          { cityId: input.cityId, countryCode: input.countryCode, cursor: input.cursor },
          sortColumn,
        );

        const whereConditions = [eq(projects.ownerId, ctx.user.id), ...paginationConditions];

        const ownedProjects = await buildProjectWithLocationQuery(db)
          .where(and(...whereConditions))
          .orderBy(sql`${sortColumn} DESC`)
          .limit(input.limit + 1);

        // AI : Get project IDs where user has authored overlays (but doesn't own the project)
        const contributedProjectIdsFromOverlays = await db
          .selectDistinct({ projectId: overlays.projectId })
          .from(overlays)
          .innerJoin(projects, eq(overlays.projectId, projects.id))
          .where(
            and(
              eq(overlays.authorId, ctx.user.id),
              sql`${projects.ownerId} != ${ctx.user.id}`, // AI : Exclude projects already owned by user
            ),
          )
          .limit(input.limit);

        // AI : Get project IDs where user has submitted change requests for overlays (but doesn't own the project)
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
              sql`${projects.ownerId} != ${ctx.user.id}`, // AI : Exclude projects already owned by user
            ),
          )
          .limit(input.limit);

        // AI : Get project IDs where user has submitted change requests directly to projects (but doesn't own the project)
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
              sql`${projects.ownerId} != ${ctx.user.id}`, // AI : Exclude projects already owned by user
            ),
          )
          .limit(input.limit);

        // AI : Combine and deduplicate project IDs from all sources
        const allContributedProjectIds = [
          ...contributedProjectIdsFromOverlays.map((p) => p.projectId),
          ...contributedProjectIdsFromOverlayChangeRequests.map((p) => p.projectId),
          ...contributedProjectIdsFromProjectChangeRequests.map((p) => p.projectId),
        ];
        const contributedProjectIds = [...new Set(allContributedProjectIds)].filter(
          (id): id is string => id !== null,
        ); // AI : Filter out nulls and assert non-null type

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
          // AI : For projects owned by user, get all overlays
          // AI : For contributed projects, get user's overlays OR overlays with user's change requests
          const ownedProjectIds = ownedProjects.map((project) => project.id);

          // AI : Get overlay IDs where user has submitted change requests
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

          const overlayIdsWithChanges = overlayIdsWithChangeRequests
            .map((overlay) => overlay.overlayId)
            .filter((id): id is string => id !== null);

          if (ownedProjectIds.length > 0 && contributedProjectIds.length > 0) {
            // AI : Both owned and contributed projects exist
            projectOverlays = await buildOverlayModerationQuery(db)
              .where(
                and(
                  // AI : Exclude rejected and replaced overlays from My Contributions
                  sql`${overlays.status} NOT IN ('rejected', 'replaced')`,
                  or(
                    // AI : All overlays for user's own projects
                    inArray(overlays.projectId, ownedProjectIds),
                    // AI : For contributed projects: user's overlays OR overlays with user's change requests
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
                ),
              )
              .orderBy(overlays.updatedAt);
          } else if (ownedProjectIds.length > 0) {
            // AI : Only owned projects exist
            projectOverlays = await buildOverlayModerationQuery(db)
              .where(
                and(
                  // AI : Exclude rejected and replaced overlays from My Contributions
                  sql`${overlays.status} NOT IN ('rejected', 'replaced')`,
                  inArray(overlays.projectId, ownedProjectIds),
                ),
              )
              .orderBy(overlays.updatedAt);
          } else if (contributedProjectIds.length > 0) {
            // AI : Only contributed projects exist
            projectOverlays = await buildOverlayModerationQuery(db)
              .where(
                and(
                  // AI : Exclude rejected and replaced overlays from My Contributions
                  sql`${overlays.status} NOT IN ('rejected', 'replaced')`,
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

        // AI : Build pagination response using shared helper (only for owned projects, as contributed are not paginated)
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
