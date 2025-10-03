import { sql, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema';
import { overlays, projects, cities, countries } from './schema';

// AI : ============================================================================
// AI : QUERY BUILDERS - Reusable query patterns for joins and location data
// AI : ============================================================================
// AI : These builders eliminate duplicate SQL join patterns across routes.
// AI : Each builder returns a chainable query that can be extended with where/orderBy/limit.
// AI : ============================================================================

/**
 * AI : Select fields for overlay queries with full location hierarchy
 * AI : Extracts PostGIS geometry as JSON for corners and centroid
 */
export const overlaySelectFields = {
  id: overlays.id,
  version: overlays.version,
  filename: overlays.filename,
  caption: overlays.caption,
  status: overlays.status,
  projectId: overlays.projectId,
  authorId: overlays.authorId,
  replacesOverlayId: overlays.replacesOverlayId,
  metadata: overlays.metadata,
  // AI : Extract corners from polygon geometry as array of {lat, lng}
  corners: sql<{lat: number, lng: number}[]>`
    (SELECT json_agg(json_build_object('lat', ST_Y(geom), 'lng', ST_X(geom)) ORDER BY path[2])
     FROM ST_DumpPoints(${overlays.corners}) AS dump(path, geom)
     WHERE path[2] <= 4)
  `,
  // AI : Extract centroid as {lat, lng}
  centroid: sql<{lat: number, lng: number}>`
    json_build_object('lat', ST_Y(${overlays.centroid}), 'lng', ST_X(${overlays.centroid}))
  `,
  createdAt: overlays.createdAt,
  updatedAt: overlays.updatedAt,
  projectName: projects.name,
  cityName: cities.name,
  cityId: cities.id,
  countryCode: countries.code,
  countryName: countries.name,
};

/**
 * AI : Build overlay query with full location joins (overlay -> project -> city -> country)
 * AI : Returns chainable query that can be extended with .where(), .orderBy(), .limit()
 */
export function buildOverlayQuery(db: PostgresJsDatabase<typeof schema>) {
  return db
    .select(overlaySelectFields)
    .from(overlays)
    .leftJoin(projects, eq(overlays.projectId, projects.id))
    .leftJoin(cities, eq(projects.cityId, cities.id))
    .leftJoin(countries, eq(cities.countryCode, countries.code));
}

/**
 * AI : Build project query with city and country location data
 * AI : Returns chainable query that can be extended with .where(), .orderBy(), .limit()
 */
export function buildProjectWithLocationQuery(db: PostgresJsDatabase<typeof schema>) {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      status: projects.status,
      version: projects.version,
      ownerId: projects.ownerId,
      cityId: projects.cityId,
      isMarker: projects.isMarker,
      lat: projects.lat,
      lng: projects.lng,
      proposalDate: projects.proposalDate,
      startDate: projects.startDate,
      endDate: projects.endDate,
      sourceUrl: projects.sourceUrl,
      latestUpdateOn: projects.latestUpdateOn,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      cityName: cities.name,
      countryCode: countries.code,
      countryName: countries.name,
      city: {
        id: cities.id,
        name: cities.name,
        countryCode: cities.countryCode,
        countryName: countries.name,
        lat: sql<number>`ST_Y(${cities.coordinates})`,
        lng: sql<number>`ST_X(${cities.coordinates})`
      }
    })
    .from(projects)
    .leftJoin(cities, eq(projects.cityId, cities.id))
    .leftJoin(countries, eq(cities.countryCode, countries.code));
}

/**
 * AI : Build overlay query with minimal fields for moderation lists
 * AI : Includes location data but not full geometry extraction
 */
export function buildOverlayModerationQuery(db: PostgresJsDatabase<typeof schema>) {
  return db
    .select({
      id: overlays.id,
      name: sql<string>`coalesce(${overlays.caption}, 'Unnamed')`,
      filename: overlays.filename,
      status: overlays.status,
      version: overlays.version,
      projectId: overlays.projectId,
      updatedAt: overlays.updatedAt,
      cityName: cities.name,
      countryCode: countries.code,
      countryName: countries.name,
    })
    .from(overlays)
    .leftJoin(projects, eq(overlays.projectId, projects.id))
    .leftJoin(cities, eq(projects.cityId, cities.id))
    .leftJoin(countries, eq(cities.countryCode, countries.code));
}

/**
 * AI : Build project query with minimal fields for moderation lists
 */
export function buildProjectModerationQuery(db: PostgresJsDatabase<typeof schema>) {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      status: projects.status,
      version: projects.version,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      startDate: projects.startDate,
      endDate: projects.endDate,
      sourceUrl: projects.sourceUrl,
      cityName: cities.name,
      countryCode: countries.code,
      countryName: countries.name,
    })
    .from(projects)
    .leftJoin(cities, eq(projects.cityId, cities.id))
    .leftJoin(countries, eq(cities.countryCode, countries.code));
}
