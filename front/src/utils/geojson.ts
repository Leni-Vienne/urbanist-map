// A project's `geometry` reaches the UI untyped (JSONB from the wire, or a raw change-request
// value). An empty collection means "no shapes" at every read site, so it parses as null too.
export function parseShapeCollection(value: unknown): GeoJSON.GeometryCollection | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    value.type !== "GeometryCollection" ||
    !("geometries" in value) ||
    !Array.isArray(value.geometries) ||
    value.geometries.length === 0
  ) {
    return null;
  }
  // oxlint-disable-next-line no-unsafe-type-assertion
  return value as GeoJSON.GeometryCollection;
}

// Walks every coordinate position in a GeoJSON geometry, invoking cb(lng, lat) for each.
// Handles every geometry type including nested Multi* variants and GeometryCollection.

function emit(position: GeoJSON.Position, cb: (lng: number, lat: number) => void): void {
  cb(position[0] ?? 0, position[1] ?? 0);
}

export function forEachPosition(
  geom: GeoJSON.Geometry,
  cb: (lng: number, lat: number) => void,
): void {
  switch (geom.type) {
    case "Point":
      emit(geom.coordinates, cb);
      break;
    case "MultiPoint":
    case "LineString":
      for (const pos of geom.coordinates) emit(pos, cb);
      break;
    case "MultiLineString":
    case "Polygon":
      for (const line of geom.coordinates) {
        for (const pos of line) {
          emit(pos, cb);
        }
      }
      break;
    case "MultiPolygon":
      for (const poly of geom.coordinates)
        for (const ring of poly) {
          for (const pos of ring) {
            emit(pos, cb);
          }
        }
      break;
    case "GeometryCollection":
      for (const g of geom.geometries) forEachPosition(g, cb);
      break;
    default:
      break;
  }
}
