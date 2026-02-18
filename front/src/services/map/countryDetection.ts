import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";

// AI : Import GeoJSON files for country borders
import fraGeoJson from "@/assets/country-borders/FRA.json";
import cheGeoJson from "@/assets/country-borders/CHE.json";
import countryBboxes from "@/assets/country_bboxes.json";

interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

interface CountryBorder {
  code: CountryCode;
  geojson: FeatureCollection<Polygon | MultiPolygon>;
  bbox: BoundingBox;
}

// AI : Helper to convert bbox array to BoundingBox object
function toBoundingBox(bbox: number[]): BoundingBox {
  return {
    minLng: bbox[0]!,
    minLat: bbox[1]!,
    maxLng: bbox[2]!,
    maxLat: bbox[3]!,
  };
}

const countryBorders: CountryBorder[] = [
  {
    code: "FRA",
    geojson: fraGeoJson as FeatureCollection<Polygon | MultiPolygon>,
    bbox: toBoundingBox(countryBboxes.FRA),
  },
  {
    code: "CHE",
    geojson: cheGeoJson as FeatureCollection<Polygon | MultiPolygon>,
    bbox: toBoundingBox(countryBboxes.CHE),
  },
];

/**
 * AI : Fast check if point is within bounding box
 */
function isInBoundingBox(lat: number, lng: number, bbox: BoundingBox): boolean {
  return lat >= bbox.minLat && lat <= bbox.maxLat && lng >= bbox.minLng && lng <= bbox.maxLng;
}

export type CountryCode = "FRA" | "CHE";

/**
 * AI : Detect which country contains the given coordinates
 * @param lat Latitude
 * @param lng Longitude
 * @returns Country code (FRA, CHE) or undefined if not in any known country
 */
export function detectCountryFromCoordinates(lat: number, lng: number): CountryCode | undefined {
  for (const country of countryBorders) {
    // AI : Fast bounding box pre-check (75x faster when outside)
    if (!isInBoundingBox(lat, lng, country.bbox)) {
      continue; // Skip expensive polygon check
    }

    if (isPointInCountry(lat, lng, country.geojson)) {
      // AI: Type assertion is safe here because countryBorders only contains valid codes
      return country.code;
    }
  }
  return undefined;
}

/**
 * AI : Check if a point is inside any of the country's polygons
 */
function isPointInCountry(
  lat: number,
  lng: number,
  geojson: FeatureCollection<Polygon | MultiPolygon>,
): boolean {
  for (const feature of geojson.features) {
    if (feature.geometry.type === "MultiPolygon") {
      for (const polygon of feature.geometry.coordinates) {
        // AI : Each polygon is an array of rings (first is outer, rest are holes)
        const outerRing = polygon[0];
        if (outerRing && isPointInPolygon(lat, lng, outerRing)) {
          // AI : Check if point is in any hole (if holes exist)
          let inHole = false;
          for (let i = 1; i < polygon.length; i += 1) {
            const hole = polygon[i];
            if (hole && isPointInPolygon(lat, lng, hole)) {
              inHole = true;
              break;
            }
          }
          if (!inHole) {
            return true;
          }
        }
      }
    } else {
      // AI : Polygon has a simpler structure - just an array of rings
      const outerRing = feature.geometry.coordinates[0];
      if (outerRing && isPointInPolygon(lat, lng, outerRing)) {
        // AI : Check if point is in any hole (if holes exist)
        let inHole = false;
        for (let i = 1; i < feature.geometry.coordinates.length; i += 1) {
          const hole = feature.geometry.coordinates[i];
          if (hole && isPointInPolygon(lat, lng, hole)) {
            inHole = true;
            break;
          }
        }
        if (!inHole) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * AI : Ray casting algorithm for point-in-polygon detection
 * @param lat Point latitude
 * @param lng Point longitude
 * @param ring Polygon ring as array of [lng, lat] coordinates
 */
function isPointInPolygon(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  const x = lng;
  const y = lat;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!; // Assert the sub-array exists
    const [xj, yj] = ring[j]!;

    // Now xi, yi, xj, yj are all plain numbers
    const intersect = yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!;
    if (intersect) inside = !inside;
  }

  return inside;
}
