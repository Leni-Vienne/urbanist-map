import { sql, type SQL } from "drizzle-orm";

// Spatial extent of a project's shape in meters. `geom` and `env` are SQL expressions for the
// geometry and its ST_Envelope (controlled literals, never user input); taking the envelope
// separately lets a bulk caller compute it once per row rather than once per reference.
//
// The traced length is capped by the bounding box, so a shape that doubles back on itself reports
// the ground it covers instead of the distance walked:
//   - LineString/MultiLineString: ST_Length, capped by the bbox diagonal
//   - Polygon/MultiPolygon:       ST_Perimeter, capped by the longest bbox side
// ST_Area > 0 discriminates the two families (ST_Dimension is unreliable on GeometryCollection).
//
// Lines:
//   - A20 motorway (170km route, ~200km bbox diagonal): LEAST(170km, 200km) = 170km
//   - B96a (675m total, 7200m bbox diagonal):           LEAST(675m,  7200m) = 675m
// Polygons:
//   - 100x100m parking lot (400m perimeter):            LEAST(400m,  100m)  = 100m
//   - circular park r=500m (3141m perimeter):           LEAST(3141m, 1000m) = 1000m (diameter)
export function geometrySizeMSql(geom: string, env: string): string {
  return `CASE
    WHEN ST_Area(${geom}) > 0 THEN
      LEAST(
        ST_Perimeter(${geom}::geography),
        GREATEST(
          ST_Distance(
            ST_MakePoint(ST_XMin(${env}), ST_YMin(${env}))::geography,
            ST_MakePoint(ST_XMax(${env}), ST_YMin(${env}))::geography
          ),
          ST_Distance(
            ST_MakePoint(ST_XMin(${env}), ST_YMin(${env}))::geography,
            ST_MakePoint(ST_XMin(${env}), ST_YMax(${env}))::geography
          )
        )
      )
    ELSE
      LEAST(
        ST_Length(${geom}::geography),
        ST_Length(ST_BoundingDiagonal(${env})::geography)
      )
  END`;
}

// Size for a single client-supplied shape, as a scalar subquery so `geomExpr` (a ST_GeomFromGeoJSON
// call carrying the GeoJSON as a bound parameter) is named once instead of re-parsed at every
// reference inside the CASE.
export function scalarGeometrySizeMSql(geomExpr: SQL): SQL {
  return sql`(SELECT ${sql.raw(geometrySizeMSql("g.geom", "ST_Envelope(g.geom)"))} FROM (SELECT ${geomExpr} AS geom) g)`;
}
