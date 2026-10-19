// A geographic circle follows the map's projection and tilt, including for coarse location fixes.
export function locationAccuracyRing(
  longitude: number,
  latitude: number,
  radiusMeters: number,
): [number, number][] {
  const radians = Math.PI / 180;
  const centerLatitude = latitude * radians;
  const angularRadius = radiusMeters / 6_371_008.8;
  const sinLatitude = Math.sin(centerLatitude);
  const cosLatitude = Math.cos(centerLatitude);
  const sinRadius = Math.sin(angularRadius);
  const cosRadius = Math.cos(angularRadius);

  function destination(bearing: number): [number, number] {
    const lat = Math.asin(sinLatitude * cosRadius + cosLatitude * sinRadius * Math.cos(bearing));
    const lngOffset = Math.atan2(
      Math.sin(bearing) * sinRadius * cosLatitude,
      cosRadius - sinLatitude * Math.sin(lat),
    );
    // Keep longitudes near the center instead of wrapping at the antimeridian.
    return [longitude + lngOffset / radians, lat / radians];
  }

  const first = destination(0);
  const ring = [first];
  const segments = 64;
  for (let index = 1; index < segments; index += 1) {
    ring.push(destination((-index * 2 * Math.PI) / segments));
  }
  ring.push(first);
  return ring;
}
