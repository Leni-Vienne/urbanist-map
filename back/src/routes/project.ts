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
  PROJECT_COLUMNS,
} from "../db/helpers";
import { deleteLocalImages } from "../lib/imageCleanup";
import { resolveBoundaryPath } from "../db/boundaryAssignment";
import { getEditSessionData } from "../services/editSession";
import { getMyChangeRequests } from "./changes";
import type { SessionUser } from "../lib/types";

function requestLanguageCode(acceptLanguage: string | undefined): string {
  const language = acceptLanguage?.split(",")[0]?.split(";")[0]?.trim().split("-")[0];
  return language && /^[a-z]{2,3}$/i.test(language) ? language.toLowerCase() : "en";
}

async function getProjectImages(projectId: string, user: SessionUser | null | undefined) {
  const [renderRows, mapOverlays] = await Promise.all([
    db
      .select({
        filename: overlays.filename,
        caption: overlays.caption,
        status: overlays.status,
      })
      .from(overlays)
      .where(
        and(
          eq(overlays.projectId, projectId),
          eq(overlays.kind, "render"),
          buildOverlayVisibilityCondition(user, "edit"),
        ),
      )
      .orderBy(
        sql`CASE WHEN ${overlays.status} = 'approved' THEN 0 ELSE 1 END`,
        desc(overlays.updatedAt),
      )
      .limit(1),
    db
      .select({
        id: overlays.id,
        filename: overlays.filename,
        caption: overlays.caption,
      })
      .from(overlays)
      .where(
        and(
          eq(overlays.projectId, projectId),
          eq(overlays.kind, "map"),
          eq(overlays.status, "approved"),
        ),
      )
      .orderBy(overlays.createdAt, overlays.id),
  ]);

  return { render: renderRows[0] ?? null, mapOverlays };
}

export const projectRouter = router({
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

      const { adminBoundaryId, ...projectData } = project;
      const [images, boundaryPath] = await Promise.all([
        getProjectImages(project.id, ctx.user),
        adminBoundaryId ? resolveBoundaryPath(adminBoundaryId) : [],
      ]);

      return { ...projectData, ...images, boundaryPath };
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
        const { adminBoundaryId, ...projectData } = project;
        const [images, boundaryPath] = await Promise.all([
          getProjectImages(project.id, ctx.user),
          adminBoundaryId ? resolveBoundaryPath(adminBoundaryId) : [],
        ]);

        return {
          found: true as const,
          project: { ...projectData, ...images, boundaryPath },
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
      const [contributionProjectRows, myChangeRequests, editSession] = await Promise.all([
        union(
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
        ),
        getMyChangeRequests(db, ctx.user.id),
        getEditSessionData(db, ctx.user),
      ]);
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

      const projectsById: Record<string, (typeof allProjects)[number]> = {};
      const overlaysById: Record<string, (typeof projectOverlays)[number]> = {};
      for (const project of allProjects) {
        projectsById[project.id] = { ...project, tags: project.tags ?? [] };
      }
      for (const overlay of projectOverlays) {
        if (!overlay.projectId) continue;
        overlaysById[overlay.id] = overlay;
      }

      return { projectsById, overlaysById, changeRequests: myChangeRequests, editSession };
    } catch (error) {
      console.error("Error fetching all projects:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch all projects",
      });
    }
  }),
});
