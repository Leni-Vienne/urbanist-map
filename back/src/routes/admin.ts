import { adminProcedure, router } from "../trpc";
import { projects, overlays, cities, users } from "../db/schema";
import { eq, sql, and, inArray } from "drizzle-orm";
import { db } from "../database";
import { deleteImages, executePendingDeletions } from "../lib/imageCleanup";
import { TRPCError } from "@trpc/server";
import { decrementCityProjectCount } from "../db/updateCityCounts";
import * as z from "zod";

// Admin-only router for managing users and their content
// All endpoints require admin role

async function loadCityDetails(userId: string, cityId: number) {
  const cityProjects = await db
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .where(and(eq(projects.cityId, cityId), eq(projects.ownerId, userId)));

  const projectIds = cityProjects.map((p) => p.id);
  if (projectIds.length === 0) {
    return { projects: cityProjects, overlays: [] };
  }

  const cityOverlays = await db
    .select({
      id: overlays.id,
      filename: overlays.filename,
      caption: overlays.caption,
      status: overlays.status,
      createdAt: overlays.createdAt,
      projectId: overlays.projectId,
      projectName: projects.name,
    })
    .from(overlays)
    .innerJoin(projects, eq(overlays.projectId, projects.id))
    .where(inArray(overlays.projectId, projectIds));

  return { projects: cityProjects, overlays: cityOverlays };
}

export const adminRouter = router({
  // Get user info and their contributions grouped by city
  // Returns list of cities with project/overlay counts for lazy loading
  adminGetUserContributions: adminProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        cityId: z.number().int().optional(), // If provided, load projects/overlays for this city
      }),
    )
    .query(async ({ input }) => {
      try {
        // Get user info
        const userInfo = await db
          .select({
            id: users.id,
            username: users.username,
            email: users.email,
            approvedCount: users.approvedCount,
            rejectedCount: users.rejectedCount,
            banned: users.banned,
          })
          .from(users)
          .where(eq(users.id, input.userId))
          .limit(1);

        const user = userInfo[0];

        if (!user) {
          throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
        }

        // Get cities with project/overlay counts for this user
        const citySummary = await db
          .select({
            cityId: cities.id,
            cityName: cities.name,
            countryCode: cities.countryCode,
            projectCount: sql<number>`count(distinct ${projects.id})::int`,
            overlayCount: sql<number>`count(distinct ${overlays.id})::int`,
          })
          .from(cities)
          .leftJoin(
            projects,
            and(eq(projects.cityId, cities.id), eq(projects.ownerId, input.userId)),
          )
          .leftJoin(overlays, eq(overlays.projectId, projects.id))
          .groupBy(cities.id, cities.name, cities.countryCode)
          .having(sql`count(distinct ${projects.id}) > 0 OR count(distinct ${overlays.id}) > 0`);

        const cityDetails = input.cityId ? await loadCityDetails(input.userId, input.cityId) : null;

        return {
          user,
          cities: citySummary,
          cityDetails,
        };
      } catch (error) {
        console.error("Error fetching user contributions:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch user contributions",
        });
      }
    }),

  // Admin-only endpoint to permanently delete a project and all its overlays
  // This removes database records AND cleans up images from R2/local storage
  deleteProject: adminProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        reason: z.string().max(500).optional(), // Optional reason for audit
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        // Get project with its overlays for cleanup
        const projectData = await db
          .select({
            id: projects.id,
            name: projects.name,
            status: projects.status,
            ownerId: projects.ownerId,
            cityId: projects.cityId,
          })
          .from(projects)
          .where(eq(projects.id, input.projectId))
          .limit(1);

        const project = projectData[0];

        if (!project) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        }

        // Get all overlays for this project (for image cleanup)
        const projectOverlays = await db
          .select({
            id: overlays.id,
            filename: overlays.filename,
            status: overlays.status,
          })
          .from(overlays)
          .where(eq(overlays.projectId, input.projectId));

        // Overlays first to satisfy the FK; both deletes must succeed or roll back together.
        await db.transaction(async (tx) => {
          if (projectOverlays.length > 0) {
            await tx.delete(overlays).where(eq(overlays.projectId, input.projectId));
          }
          await tx.delete(projects).where(eq(projects.id, input.projectId));
        });

        // City counter is a denormalized cache (eventually consistent), kept outside the transaction.
        if (project.status === "approved" && project.cityId) {
          try {
            await decrementCityProjectCount(project.cityId);
          } catch (error) {
            console.error(
              `Failed to decrement city project count for city ${project.cityId}:`,
              error,
            );
          }
        }

        // Log deletion for audit trail
        console.log(
          `Admin ${ctx.user.id} deleted project ${input.projectId} "${project.name}" (${projectOverlays.length} overlays)${input.reason ? ` - Reason: ${input.reason}` : ""}`,
        );

        // Clean up overlay images
        for (const overlay of projectOverlays) {
          try {
            await deleteImages(overlay.filename, "both");
          } catch (error) {
            console.error(`Failed to delete images for overlay ${overlay.id}:`, error);
            // Continue - don't fail if image cleanup fails
          }
        }

        return {
          success: true,
          deletedProjectId: input.projectId,
          deletedOverlayCount: projectOverlays.length,
        };
      } catch (error) {
        console.error("Error deleting project:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete project",
        });
      }
    }),

  // Manually trigger execution of all due scheduled image deletions
  // Replaces the cron-based cleanup-images.ts script with an on-demand admin action
  pruneScheduledDeletions: adminProcedure.mutation(async () => {
    try {
      const result = await executePendingDeletions();
      return result;
    } catch (error) {
      console.error("Error running scheduled deletions:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to run scheduled deletions",
      });
    }
  }),
});
