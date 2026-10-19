import { describe, expect, test } from "bun:test";
import { locationAccuracyRing } from "./locationAccuracyGeometry";

function distanceMeters(a: [number, number], b: [number, number]): number {
  const radians = Math.PI / 180;
  const latitudeDifference = (b[1] - a[1]) * radians;
  const longitudeDifference = (b[0] - a[0]) * radians;
  const haversine =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(longitudeDifference / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(haversine));
}

describe("location accuracy geometry", () => {
  test("draws a closed geographic ring at the reported radius, from GPS to regional estimates", () => {
    const center: [number, number] = [18.0686, 59.3293];
    for (const radius of [8, 1000, 457_300]) {
      const ring = locationAccuracyRing(...center, radius);
      expect(ring.at(-1)).toEqual(ring[0]);
      const longitudes = ring.map(([longitude]) => longitude);
      const latitudes = ring.map(([, latitude]) => latitude);
      expect(Math.min(...longitudes)).toBeLessThan(center[0]);
      expect(Math.max(...longitudes)).toBeGreaterThan(center[0]);
      expect(Math.min(...latitudes)).toBeLessThan(center[1]);
      expect(Math.max(...latitudes)).toBeGreaterThan(center[1]);
      for (const point of ring) {
        expect(Math.abs(distanceMeters(center, point) - radius)).toBeLessThan(0.001);
      }
    }
  });

  test("keeps an accuracy area crossing the antimeridian together", () => {
    const center: [number, number] = [179.9, 0];
    const ring = locationAccuracyRing(...center, 50_000);
    const longitudes = ring.map(([longitude]) => longitude);
    expect(Math.max(...longitudes)).toBeGreaterThan(180);
    expect(Math.max(...longitudes) - Math.min(...longitudes)).toBeLessThan(1);
    for (const point of ring) {
      expect(Math.abs(distanceMeters(center, point) - 50_000)).toBeLessThan(0.001);
    }
  });

  test("handles a zero accuracy radius without invalid coordinates", () => {
    const center: [number, number] = [2.35, 48.85];
    for (const point of locationAccuracyRing(...center, 0)) {
      expect(distanceMeters(center, point)).toBeLessThan(0.001);
    }
  });
});
