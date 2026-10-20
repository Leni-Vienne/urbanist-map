import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { GeoJSONGeometryCollectionSchema } from "zod-geojson";
import { calculateCentroidFromCorners } from "@shared/overlayValidation";
import { scalarGeometrySizeMSql } from "./geometrySize";

type Coordinate = { lat: number; lng: number };
type Quad = [Coordinate, Coordinate, Coordinate, Coordinate];

function isCoordinate(value: unknown): value is Coordinate {
  return (
    typeof value === "object" &&
    value !== null &&
    "lat" in value &&
    "lng" in value &&
    typeof value.lat === "number" &&
    typeof value.lng === "number" &&
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lng) &&
    value.lat >= -90 &&
    value.lat <= 90 &&
    value.lng >= -180 &&
    value.lng <= 180
  );
}

export function parseCoordinate(value: unknown): Coordinate {
  if (!isCoordinate(value)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid latitude/longitude coordinate" });
  }
  return value;
}

function isQuad(value: unknown): value is Quad {
  return Array.isArray(value) && value.length === 4 && value.every(isCoordinate);
}

export function pointSql(coordinate: Coordinate): SQL {
  return sql`ST_SetSRID(ST_MakePoint(${coordinate.lng}, ${coordinate.lat}), 4326)`;
}

// Keep the footprint and its arithmetic center in the same write, including approved edits.
export function overlayGeometryValues(value: unknown) {
  if (!isQuad(value)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Corners must be four valid coordinates" });
  }
  const [topLeft, topRight, bottomRight, bottomLeft] = value;
  const centroid = calculateCentroidFromCorners(value);
  if (!centroid)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid corner coordinates" });
  return {
    corners: sql`ST_SetSRID(ST_MakePolygon(ST_MakeLine(ARRAY[
      ST_MakePoint(${topLeft.lng}, ${topLeft.lat}),
      ST_MakePoint(${topRight.lng}, ${topRight.lat}),
      ST_MakePoint(${bottomRight.lng}, ${bottomRight.lat}),
      ST_MakePoint(${bottomLeft.lng}, ${bottomLeft.lat}),
      ST_MakePoint(${topLeft.lng}, ${topLeft.lat})
    ])), 4326)`,
    centroid: pointSql(centroid),
  };
}

export function projectGeometryValues(value: unknown) {
  if (value === null || value === undefined) return { geometry: null, geometrySizeM: null };
  const parsed = GeoJSONGeometryCollectionSchema.safeParse(value);
  if (!parsed.success) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid GeoJSON GeometryCollection" });
  }
  const geometry = sql`ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(parsed.data)}), 4326))`;
  return { geometry, geometrySizeM: scalarGeometrySizeMSql(geometry) };
}

// Preserve the editor's corner order; the polygon's closing fifth point is not a corner.
export function overlayCornersJsonSql(column: SQLWrapper): SQL<Coordinate[]> {
  return sql`(
    SELECT json_agg(json_build_object('lat', ST_Y(geom), 'lng', ST_X(geom)) ORDER BY path[2])
    FROM ST_DumpPoints(${column}) AS dump(path, geom)
    WHERE path[2] <= 4
  )`;
}
