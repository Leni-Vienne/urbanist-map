import { moderatorProcedure } from "../../trpc";
import { checkModeratorCountryPermission } from "./shared";
import { invalidateProjectTiles, invalidateOverlayTiles } from "../tiles";
import { invalidateLatestContributionsCache } from "../feed";
import {
  projects,
  overlays,
  changeRequests,
  changeHistory,
  deletedProjects,
} from "../../db/schema";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../database";
import { TRPCError } from "@trpc/server";
import * as z from "zod";

export const detachedProcedures = {
  // Lists projects whose OSM source disappeared (detached_at set) and that the moderator can
  // moderate, each with candidate live projects to re-link onto. Candidates are ranked by shared
  // osm_ids first (catches partial OSM redraws), then by spatial proximity (the fallback when the
  // feature was fully redrawn or consolidated into a relation and shares no ids). Suggestions only:
  // the moderator confirms. Scoped per country since a redraw stays in-country and permissions are
  // country-scoped.
  getDetachedProjects: moderatorProcedure.query(async ({ ctx }) => {
    try {
      const isAdmin = ctx.user.role === "admin";
      const allowed = ctx.user.moderatedCountries ?? [];
      if (!isAdmin && allowed.length === 0) return [];

      const countryFilter = isAdmin
        ? sql`TRUE`
        : sql`o.country_code = ANY(ARRAY[${sql.join(
            allowed.map((c) => sql`${c}`),
            sql`, `,
          )}]::text[])`;

      const rows = await db.execute<{
        id: string;
        name: string | null;
        slug: string | null;
        countryCode: string;
        detachedAt: string;
        tags: string[] | null;
        lat: number | null;
        lng: number | null;
        geometry: GeoJSON.GeometryCollection | null;
        overlayCount: number;
        hasManualEdits: boolean;
        editedFields: string[];
        candidates: {
          id: string;
          name: string | null;
          slug: string | null;
          sourceUrl: string | null;
          tags: string[] | null;
          lat: number | null;
          lng: number | null;
          geometry: GeoJSON.GeometryCollection | null;
          distanceM: number | null;
          sharedIds: number;
        }[];
      }>(sql`
        SELECT
          o.id,
          o.name,
          o.slug,
          o.country_code AS "countryCode",
          o.detached_at AS "detachedAt",
          o.tags,
          o.lat,
          o.lng,
          -- Simplified, low-precision shape for an inline thumbnail (visual disambiguation in the
          -- candidate list). NULL for point-only projects, which fall back to a marker dot.
          CASE WHEN o.geometry IS NOT NULL
            THEN ST_AsGeoJSON(ST_Simplify(o.geometry, 0.00003), 5)::json
            ELSE NULL END AS "geometry",
          (SELECT COUNT(*)::int FROM overlays ov WHERE ov.project_id = o.id) AS "overlayCount",
          o.import_locked_at IS NOT NULL AS "hasManualEdits",
          -- Fields a user edited on this project (approved change history). Re-linking moves images
          -- and history pointers to the target but discards the orphan's own column values, so these
          -- edits are lost unless the moderator keeps it standalone instead.
          COALESCE((
            SELECT json_agg(DISTINCT ch.field_name)
            FROM change_history ch
            WHERE ch.entity_type = 'project' AND ch.entity_id = o.id
          ), '[]'::json) AS "editedFields",
          COALESCE((
            SELECT json_agg(c ORDER BY c."sharedIds" DESC, c."distanceM" ASC)
            FROM (
              SELECT
                cand.id,
                cand.name,
                cand.slug,
                cand.source_url AS "sourceUrl",
                cand.tags,
                cand.lat,
                cand.lng,
                CASE WHEN cand.geometry IS NOT NULL
                  THEN ST_AsGeoJSON(ST_Simplify(cand.geometry, 0.00003), 5)::json
                  ELSE NULL END AS "geometry",
                ST_Distance(cand.center_coordinate::geography, o.center_coordinate::geography) AS "distanceM",
                (
                  SELECT COUNT(*)::int
                  FROM jsonb_array_elements_text(o.external_properties->'osm_ids') a
                  JOIN jsonb_array_elements_text(cand.external_properties->'osm_ids') b ON a.value = b.value
                ) AS "sharedIds"
              FROM projects cand
              WHERE cand.id <> o.id
                AND cand.import_source_id IS NOT NULL
                AND cand.detached_at IS NULL
                AND cand.status = 'approved'
                AND cand.center_coordinate IS NOT NULL
                AND cand.country_code = o.country_code
                AND (
                  (o.external_properties ? 'osm_ids'
                    AND cand.external_properties ? 'osm_ids'
                    AND (cand.external_properties->'osm_ids') ?| ARRAY(
                      SELECT jsonb_array_elements_text(o.external_properties->'osm_ids')
                    ))
                  OR ST_DWithin(cand.center_coordinate::geography, o.center_coordinate::geography, 1500)
                )
              ORDER BY "sharedIds" DESC, "distanceM" ASC
              LIMIT 6
            ) c
          ), '[]'::json) AS candidates
        FROM projects o
        WHERE o.detached_at IS NOT NULL
          AND o.center_coordinate IS NOT NULL
          AND ${countryFilter}
        ORDER BY o.detached_at DESC
        LIMIT 200
      `);

      return rows;
    } catch (error) {
      console.error("Error fetching detached projects:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch detached projects",
      });
    }
  }),

  // Re-link a detached project onto a live one: move its overlays and re-point its approved change
  // requests/history (entity_id has no FK, so a plain delete would silently orphan them), then drop
  // the now-empty detached project. The target keeps its own OSM-fed fields; only the human content
  // travels.
  relinkDetachedProject: moderatorProcedure
    .input(z.object({ orphanId: z.uuid(), targetProjectId: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      try {
        if (input.orphanId === input.targetProjectId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot re-link a project to itself",
          });
        }
        await checkModeratorCountryPermission(input.orphanId, ctx.user);
        await checkModeratorCountryPermission(input.targetProjectId, ctx.user);

        const result = await db.transaction(async (tx) => {
          const orphanRows = await tx
            .select({
              id: projects.id,
              detachedAt: projects.detachedAt,
              slug: projects.slug,
              lat: projects.lat,
              lng: projects.lng,
            })
            .from(projects)
            .where(eq(projects.id, input.orphanId))
            .limit(1);

          const orphan = orphanRows[0];
          if (!orphan) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Detached project not found" });
          }
          if (!orphan.detachedAt) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Project is not detached" });
          }

          const targetRows = await tx
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.id, input.targetProjectId))
            .limit(1);
          if (!targetRows[0]) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Target project not found" });
          }

          const movedOverlays = await tx
            .update(overlays)
            .set({ projectId: input.targetProjectId })
            .where(eq(overlays.projectId, input.orphanId))
            .returning({ id: overlays.id });

          await tx
            .update(changeRequests)
            .set({ entityId: input.targetProjectId })
            .where(
              and(
                eq(changeRequests.entityType, "project"),
                eq(changeRequests.entityId, input.orphanId),
              ),
            );

          await tx
            .update(changeHistory)
            .set({ entityId: input.targetProjectId })
            .where(
              and(
                eq(changeHistory.entityType, "project"),
                eq(changeHistory.entityId, input.orphanId),
              ),
            );

          // Tombstone the orphan before deleting it so an indexed /project:slug URL answers 410
          // instead of 404 once its row is gone (the content now lives under the target's own slug).
          // Skip rows without a slug; ON CONFLICT refreshes a recurring slug's coords.
          if (orphan.slug) {
            await tx
              .insert(deletedProjects)
              .values({ slug: orphan.slug, lat: orphan.lat, lng: orphan.lng, status: "removed" })
              .onConflictDoUpdate({
                target: deletedProjects.slug,
                set: { lat: orphan.lat, lng: orphan.lng, status: "removed", deletedAt: new Date() },
              });
          }

          await tx.delete(projects).where(eq(projects.id, input.orphanId));

          return {
            movedOverlayIds: movedOverlays.map((o) => o.id),
          };
        });

        await invalidateProjectTiles(input.orphanId);
        await invalidateProjectTiles(input.targetProjectId);
        for (const overlayId of result.movedOverlayIds) {
          await invalidateOverlayTiles(overlayId);
        }
        invalidateLatestContributionsCache();

        return { success: true, movedOverlays: result.movedOverlayIds.length };
      } catch (error) {
        console.error("Error re-linking detached project:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to re-link detached project",
        });
      }
    }),

  // Confirm a detached project as a permanent standalone: clear detached_at so it leaves the queue
  // and behaves like any user-created standalone project (its OSM link was already severed on prune).
  dismissDetachedProject: moderatorProcedure
    .input(z.object({ projectId: z.uuid() }))
    .mutation(async ({ input, ctx }) => {
      try {
        await checkModeratorCountryPermission(input.projectId, ctx.user);
        const updated = await db
          .update(projects)
          .set({ detachedAt: null })
          .where(and(eq(projects.id, input.projectId), sql`${projects.detachedAt} IS NOT NULL`))
          .returning({ id: projects.id });
        if (!updated[0]) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Detached project not found" });
        }
        return { success: true };
      } catch (error) {
        console.error("Error dismissing detached project:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to dismiss detached project",
        });
      }
    }),
};
