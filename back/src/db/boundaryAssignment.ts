import { sql, type SQL } from "drizzle-orm";
import { db } from "../database";

// Resolve a project's 3-letter country code from the admin boundaries covering (or nearest to) a
// point. A point inside any boundary has distance 0, so the KNN ordering naturally returns a
// covering boundary first and falls back to the closest one otherwise (e.g. a point just offshore).
// Every boundary row carries the denormalized country_code, so any covering boundary in the nested
// country/state/city stack yields the same, correct country. Returns null only when no boundary
// with a country code exists at all (empty/unimported boundaries).
export async function resolveCountryCode(lat: number, lng: number): Promise<string | null> {
  const rows = (await db.execute(sql`
    SELECT country_code
    FROM admin_boundaries
    WHERE country_code IS NOT NULL
    ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)
    LIMIT 1
  `)) as { country_code: string | null }[];

  return rows[0]?.country_code ?? null;
}

// All name variants ship to the client so it can pick by UI locale (matches the feed pattern):
// `names?.[locale] ?? nameEn ?? name`. Keeps this endpoint locale-agnostic.
export interface BoundaryPathEntry {
  osmId: string;
  name: string; // OSM `name` (usually local language)
  nameEn: string | null; // OSM `name:en`
  names: Record<string, string> | null; // all `name:*` variants, keyed by language code
  adminLevel: number;
}

// Walk the admin boundary parent chain from a project's assigned boundary up to the country,
// returning the hierarchy ordered deepest-first (e.g. neighborhood, city, state, country) for a
// location breadcrumb. The depth guard stops a malformed parent cycle from looping forever.
export async function resolveBoundaryPath(adminBoundaryId: string): Promise<BoundaryPathEntry[]> {
  try {
    const rows = (await db.execute(sql`
      WITH RECURSIVE chain AS (
        SELECT osm_id, parent_id, name, name_en, names, admin_level, 1 AS depth
        FROM admin_boundaries
        WHERE osm_id = ${adminBoundaryId}
        UNION ALL
        SELECT ab.osm_id, ab.parent_id, ab.name, ab.name_en, ab.names, ab.admin_level, c.depth + 1
        FROM admin_boundaries ab
        JOIN chain c ON ab.osm_id = c.parent_id
        WHERE c.depth < 12
      )
      SELECT osm_id, name, name_en, names, admin_level FROM chain ORDER BY admin_level DESC
    `)) as {
      osm_id: string;
      name: string;
      name_en: string | null;
      names: Record<string, string> | null;
      admin_level: number;
    }[];

    return rows.map((r) => ({
      osmId: r.osm_id,
      name: r.name,
      nameEn: r.name_en,
      names: r.names,
      adminLevel: r.admin_level,
    }));
  } catch (error) {
    console.error("Error resolving boundary path:", error);
    return [];
  }
}

// A project attaches to the deepest admin boundary that covers at least this fraction of its
// shape. 0.8 encodes the agreed rule: a project is assigned to its majority boundary unless a
// sibling is "close" (within 20%), in which case no boundary at that level clears 80% and the
// query falls through to the next level up (the shared parent), which covers ~100%.
//
// Examples:
//   - condo fully inside a neighborhood  -> neighborhood (frac 1.0)
//   - line 85% in one neighborhood       -> that neighborhood (clear majority)
//   - line split 60/40 across two        -> their shared city (neither neighborhood clears 0.8)
//   - 500km line across five states      -> the country (no single state clears 0.8)
export const BOUNDARY_DOMINANCE_THRESHOLD = 0.8;

// A project's effective footprint for boundary assignment: the union of its own geometry and the
// corners of its approved map overlays, falling back to the marker point when neither exists.
// Standalone projects carry no geometry, so their real extent lives in the overlays users place on
// the map; ignoring those would assign such a project by its marker alone (often miles from where
// the overlays actually sit). Only approved, kind='map' overlays count: pending uploads must not
// move an already-approved project's boundary, and renders carry no corners.
//
// ST_Dump flattens the project's GeometryCollection into its component parts so ST_Collect builds a
// single flat collection (no nested GeometryCollection, which downstream PostGIS functions mishandle).
// ST_Dump(NULL) yields zero rows, so a geometry-less project contributes nothing here and falls back
// to center_coordinate. `alias` is the projects-table alias (a controlled literal, never user input).
export function projectEffectiveGeometrySql(alias: string): string {
  return `(
    SELECT COALESCE(ST_Collect(parts.geom), ${alias}.center_coordinate)
    FROM (
      SELECT (ST_Dump(${alias}.geometry)).geom AS geom
      UNION ALL
      SELECT o.corners AS geom
      FROM overlays o
      WHERE o.project_id = ${alias}.id
        AND o.kind = 'map'
        AND o.status = 'approved'
        AND o.corners IS NOT NULL
    ) parts
    WHERE parts.geom IS NOT NULL
  )`;
}

// The straddling-border branch of coverageFractionSql calls safe_overlay_fraction(b_geom, p_geom),
// a total (never-throwing) PL/pgSQL function provisioned by migration (drizzle/*_safe_overlay_fraction).
// A single row that throws inside a set-based UPDATE aborts the whole batch, so its fraction
// computation is incapable of throwing regardless of input geometry:
//   - dim 2 (polygons): fraction by area. dim 1 (lines): fraction by length.
//   - ST_MakeValid + ST_CollectionExtract repairs the two cases a raw overlay rejects: a project
//     polygon overlapping/nesting its own overlay corners (invalid MultiPolygon) and a mixed
//     line+polygon collection ("Overlay input is mixed-dimension"). The dim-2 denominator reuses the
//     normalized geometry so an overlapping footprint is not double-counted.
//   - EXCEPTION handler: GEOS can still throw a robustness error ("side location conflict") on
//     geometry that is valid and single-dimension, with no expression-level repair. The handler
//     degrades that row to interior-point containment (1.0 for any boundary whose polygon holds a
//     representative point of the project, so the caller's `ORDER BY admin_level DESC` picks the
//     deepest), instead of poisoning the batch. ST_PointOnSurface is tried first (guaranteed inside)
//     and falls back to ST_Centroid, which is total on every geometry type (including the
//     GeometryCollection PointOnSurface rejects), so the handler itself can never throw.

// Fraction of a project's effective shape (see projectEffectiveGeometrySql) that falls inside a
// candidate boundary `b`. `geom` is a SQL expression for that shape (typically `eff.geom`, so the
// expensive union is built once per project, not once per branch). A shape fully inside the boundary
// covers it 100%, so ST_Covers (a cheap boolean predicate, no geometry built) short-circuits to 1.0
// for the contained majority and the overlay only runs for the rare project straddling a border.
// Keeping ST_Covers out of safe_overlay_fraction means that function's per-call subtransaction cost
// (from its EXCEPTION block) is paid only on straddling rows, never on the contained majority.
export function coverageFractionSql(geom: string): string {
  return `CASE
    WHEN ${geom} IS NULL THEN 1.0
    WHEN ST_Covers(b.geom, ${geom}) THEN 1.0
    ELSE safe_overlay_fraction(b.geom, ${geom})
  END`;
}

// Assign one project to its boundary. Used on the user-submission path and re-run when a map
// overlay is approved (its corners change the footprint). Sets NULL when no boundary covers the
// project (e.g. boundaries not yet imported for that area). The effective geometry is materialized
// once in `eff` (OFFSET 0 fences subquery pull-up) so the coverage CASE references a cheap column.
function assignProjectBoundarySql(projectId: string): SQL {
  return sql`
    UPDATE projects pr
    SET admin_boundary_id = (
      SELECT c.boundary_id
      FROM (SELECT ${sql.raw(projectEffectiveGeometrySql("pr"))} AS geom OFFSET 0) eff
      JOIN LATERAL (
        SELECT b.osm_id AS boundary_id, b.admin_level,
               ${sql.raw(coverageFractionSql("eff.geom"))} AS frac
        FROM admin_boundaries b
        WHERE ST_Intersects(b.geom, eff.geom)
      ) c ON true
      WHERE c.frac >= ${BOUNDARY_DOMINANCE_THRESHOLD}
      ORDER BY c.admin_level DESC, c.frac DESC
      LIMIT 1
    )
    WHERE pr.id = ${projectId}
  `;
}

// Best-effort wrapper: boundary assignment is a derived categorization, so a failure here must
// never block or roll back the caller's write. Runs on its own connection (module-level db).
export async function assignProjectBoundary(projectId: string): Promise<void> {
  try {
    await db.execute(assignProjectBoundarySql(projectId));
  } catch (error) {
    console.error(`Failed to assign boundary for project ${projectId}:`, error);
  }
}
