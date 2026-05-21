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
