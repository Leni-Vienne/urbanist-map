import * as z from "zod";
import { publicProcedure, router, TRPCError } from "../trpc";
import { adminBoundaries } from "../db/schema";
import { sql } from "drizzle-orm";
import { db } from "../database";
import { countAlphanumeric, MIN_LOCATION_SEARCH_ALNUM } from "@shared/locationSearch";

const searchBoundariesNearLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  search: z.string().min(1).max(100),
  limit: z.number().min(1).max(25).default(10),
});

// Name variants of one boundary, shipped locale-agnostically so the client picks by UI locale.
type LocalizedBoundaryName = {
  name: string; // OSM `name` (usually local language)
  nameEn: string | null; // OSM `name:en`
  names: Record<string, string> | null; // all `name:*` variants, keyed by language code
};

type Ancestors = {
  city: LocalizedBoundaryName | null; // deepest of admin_level 6..8
  state: LocalizedBoundaryName | null; // admin_level 4
  country: LocalizedBoundaryName | null; // admin_level 2
};

// Resolve city/state/country ancestors for a set of boundaries in one query. A recursive CTE walks
// every root's parent_id chain at once (PK lookup + idx_admin_boundaries_parent, both indexed),
// tagging each chain row with its root_id, then we bucket by admin_level in JS. Done as its own
// query rather than correlated subqueries on the search so the search keeps its trigram-index plan
// (correlated recursive subqueries forced a full table scan and timed out).
async function resolveAncestors(osmIds: string[]): Promise<Map<string, Ancestors>> {
  const byRoot = new Map<string, Ancestors>();
  if (osmIds.length === 0) return byRoot;

  const idList = sql.join(
    osmIds.map((id) => sql`${id}`),
    sql`, `,
  );

  // oxlint-disable-next-line no-unsafe-type-assertion
  const rows = (await db.execute(sql`
    WITH RECURSIVE chain AS (
      SELECT osm_id AS root_id, osm_id, parent_id, admin_level, name, name_en, names, 1 AS depth
      FROM admin_boundaries
      WHERE osm_id IN (${idList})
      UNION ALL
      SELECT c.root_id, ab.osm_id, ab.parent_id, ab.admin_level, ab.name, ab.name_en, ab.names, c.depth + 1
      FROM admin_boundaries ab
      JOIN chain c ON ab.osm_id = c.parent_id
      WHERE c.depth < 12
    )
    SELECT root_id, admin_level, name, name_en, names FROM chain
    WHERE admin_level IN (2, 4) OR admin_level BETWEEN 6 AND 8
  `)) as {
    root_id: string;
    admin_level: number;
    name: string;
    name_en: string | null;
    names: Record<string, string> | null;
  }[];

  // For the city bucket (6..8), keep the deepest level seen so a municipality (8) wins over a
  // county (6) in the same chain.
  const cityLevel = new Map<string, number>();

  for (const row of rows) {
    let entry = byRoot.get(row.root_id);
    if (!entry) {
      entry = { city: null, state: null, country: null };
      byRoot.set(row.root_id, entry);
    }
    const value: LocalizedBoundaryName = { name: row.name, nameEn: row.name_en, names: row.names };
    if (row.admin_level === 2) {
      entry.country = value;
    } else if (row.admin_level === 4) {
      entry.state = value;
    } else if (row.admin_level > (cityLevel.get(row.root_id) ?? -1)) {
      cityLevel.set(row.root_id, row.admin_level);
      entry.city = value;
    }
  }

  return byRoot;
}

export const boundariesRouter = router({
  // Search admin boundaries by name (local name, English name, or any `name:*` variant),
  // ranked exact > prefix > contains, then by distance from the given location. Powers the
  // map's location search box.
  //
  // Both sides are run through immutable_search_text (accent fold + lowercase + strip
  // non-alphanumerics), so "val de", "val-de" and "valde" all match "Val-de-Marne". The matching
  // columns are backed by pg_trgm GIN indexes (idx_admin_boundaries_*_trgm), so the candidate set
  // comes from the trigram index instead of scanning the whole table by distance. The names::text
  // branch is a cheap trigram prefilter; the EXISTS recheck confirms the term matched an actual
  // value (not a language key) in the `names` jsonb.
  searchBoundariesNearLocation: publicProcedure
    .input(searchBoundariesNearLocationSchema)
    .query(async ({ input }) => {
      try {
        const { lat, lng, search, limit } = input;
        const searchTrimmed = search.trim();

        // Stripped of punctuation, too-short queries can't use the trigram index. Return early
        // rather than triggering a full table scan.
        if (countAlphanumeric(searchTrimmed) < MIN_LOCATION_SEARCH_ALNUM) return [];

        const point = sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`;
        const normTerm = sql`immutable_search_text(${searchTrimmed})`;
        const containsPattern = sql`'%' || ${normTerm} || '%'`;
        const prefixPattern = sql`${normTerm} || '%'`;

        const matches = await db
          .select({
            osmId: adminBoundaries.osmId,
            name: adminBoundaries.name,
            nameEn: adminBoundaries.nameEn,
            names: sql<Record<string, string> | null>`${adminBoundaries.names}`,
            countryCode: adminBoundaries.countryCode,
            adminLevel: adminBoundaries.adminLevel,
            // Bounding box of the boundary so the client can fit the whole shape instead of flying
            // to an arbitrary interior point at a fixed zoom. Reads the geometry's cached bbox.
            minLng: sql<number>`ST_XMin(${adminBoundaries.geom})`,
            minLat: sql<number>`ST_YMin(${adminBoundaries.geom})`,
            maxLng: sql<number>`ST_XMax(${adminBoundaries.geom})`,
            maxLat: sql<number>`ST_YMax(${adminBoundaries.geom})`,
          })
          .from(adminBoundaries)
          .where(
            sql`${adminBoundaries.geom} IS NOT NULL AND (
              immutable_search_text(${adminBoundaries.name}) LIKE ${containsPattern}
              OR immutable_search_text(coalesce(${adminBoundaries.nameEn}, '')) LIKE ${containsPattern}
              OR (
                immutable_search_text(coalesce(${adminBoundaries.names}::text, '')) LIKE ${containsPattern}
                AND EXISTS (
                  SELECT 1 FROM jsonb_each_text(coalesce(${adminBoundaries.names}, '{}'::jsonb)) AS n(k, v)
                  WHERE immutable_search_text(v) LIKE ${containsPattern}
                )
              )
            )`,
          )
          .orderBy(
            // Exact name match first (local or English name)
            sql`CASE WHEN immutable_search_text(${adminBoundaries.name}) = ${normTerm}
              OR immutable_search_text(coalesce(${adminBoundaries.nameEn}, '')) = ${normTerm} THEN 0 ELSE 1 END`,
            // Then prefix matches
            sql`CASE WHEN immutable_search_text(${adminBoundaries.name}) LIKE ${prefixPattern}
              OR immutable_search_text(coalesce(${adminBoundaries.nameEn}, '')) LIKE ${prefixPattern} THEN 0 ELSE 1 END`,
            // Finally, closest to the current map location
            sql`${adminBoundaries.geom} <-> ${point}`,
          )
          .limit(limit);

        const ancestors = await resolveAncestors(matches.map((m) => m.osmId));

        return matches.map((m) => {
          const a = ancestors.get(m.osmId);
          return Object.assign({}, m, {
            city: a?.city ?? null,
            state: a?.state ?? null,
            country: a?.country ?? null,
          });
        });
      } catch (error) {
        console.error("Error searching boundaries near location:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to search boundaries near location",
        });
      }
    }),
});
