import { adminProcedure, router } from "../trpc";
import { projects, overlays, cities, users } from "../db/schema";
import { eq, sql, and, inArray } from "drizzle-orm";
import { db } from "../database";
import { deleteImages } from "../lib/imageCleanup";
import { TRPCError } from "@trpc/server";
import { decrementCityProjectCount } from "../db/updateCityCounts";
import * as z from "zod";

// AI : Admin-only router for managing users and their content
// AI : All endpoints require admin role

export const adminRouter = router({
  // AI : Get user info and their contributions grouped by city
  // AI : Returns list of cities with project/overlay counts for lazy loading
  adminGetUserContributions: adminProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        cityId: z.number().int().optional(), // AI : If provided, load projects/overlays for this city
      }),
    )
    .query(async ({ input }) => {
      try {
        // AI : Get user info
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

        if (userInfo.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
        }

        const user = userInfo[0];

        // AI : Get cities with project/overlay counts for this user
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

        let cityDetails = null;

        // AI : If cityId provided, load full project/overlay details for that city
        if (input.cityId) {
          const cityProjects = await db
            .select({
              id: projects.id,
              name: projects.name,
              status: projects.status,
              createdAt: projects.createdAt,
            })
            .from(projects)
            .where(and(eq(projects.cityId, input.cityId), eq(projects.ownerId, input.userId)));

          // AI : Get overlays for these projects
          const projectIds = cityProjects.map((p) => p.id);

          let cityOverlays: {
            id: string;
            filename: string;
            caption: string | null;
            status: "pending" | "approved" | "rejected" | "replaced";
            createdAt: Date;
            projectId: string | null;
            projectName: string | null;
          }[] = [];

          if (projectIds.length > 0) {
            cityOverlays = await db
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
          }

          cityDetails = {
            projects: cityProjects,
            overlays: cityOverlays,
          };
        }

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

  // AI : Admin-only endpoint to permanently delete a project and all its overlays
  // AI : This removes database records AND cleans up images from R2/local storage
  deleteProject: adminProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        reason: z.string().max(500).optional(), // AI : Optional reason for audit
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        // AI : Get project with its overlays for cleanup
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

        if (projectData.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        }

        const project = projectData[0];

        // AI : Get all overlays for this project (for image cleanup)
        const projectOverlays = await db
          .select({
            id: overlays.id,
            filename: overlays.filename,
            status: overlays.status,
          })
          .from(overlays)
          .where(eq(overlays.projectId, input.projectId));

        // AI : Delete overlays first (foreign key constraint)
        if (projectOverlays.length > 0) {
          await db.delete(overlays).where(eq(overlays.projectId, input.projectId));
        }

        // AI : Delete project
        await db.delete(projects).where(eq(projects.id, input.projectId));

        // AI : Decrement city project count
        if (project.status === "approved" && project.cityId) {
          await decrementCityProjectCount(project.cityId);
        }

        // AI : Log deletion for audit trail
        console.log(
          `Admin ${ctx.user.id} deleted project ${input.projectId} "${project.name}" (${projectOverlays.length} overlays)${input.reason ? ` - Reason: ${input.reason}` : ""}`,
        );

        // AI : Clean up overlay images
        for (const overlay of projectOverlays) {
          try {
            await deleteImages(overlay.filename, "both");
          } catch (error) {
            console.error(`Failed to delete images for overlay ${overlay.id}:`, error);
            // AI : Continue - don't fail if image cleanup fails
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
});
