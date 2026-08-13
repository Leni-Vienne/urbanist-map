/**
 * Stats for the extracted OSM GeoJSON, in the same shape as the projects-table stats, so a
 * not-yet-imported extract can be diffed against the table as it stands.
 *
 * Usage:
 *   bun run back/src/scripts/stats-osm-geojson.ts         print stats for the GeoJSON
 *   bun run back/src/scripts/stats-osm-geojson.ts diff    diff the table (before) against the GeoJSON (after)
 *
 * The diff answers "what would importing this extract change?" without running the import.
 * Features sharing an external id are collapsed the way the upsert collapses them, so counts are
 * comparable to table rows.
 *
 * country_code is assigned by a spatial lookup during import and has no GeoJSON counterpart, so the
 * country distribution is left empty here and omitted from the diff rather than reported as lost.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { sql } from "drizzle-orm";
import {
  collectSnapshot as collectDbSnapshot,
  printDiff,
  printSnapshot,
  type Distribution,
  type Snapshot,
} from "./stats-osm";
import { centroid, deriveSourceUrl, extractTags, mapTimelineStatus } from "./osmDerive";

const GEOJSON_PATHS = [
  path.join(process.cwd(), "scripts/osm-extract/planet-latest_proposed_linear.geojson"),
  path.join(process.cwd(), "scripts/osm-extract/planet-latest_proposed_areal.geojson"),
];

function bump(dist: Distribution, key: string): void {
  dist[key] = (dist[key] ?? 0) + 1;
}

const EARTH_RADIUS_M = 6_371_008.8;

function haversine(a: number[], b: number[]): number {
  const lng1 = ((a[0] ?? 0) * Math.PI) / 180;
  const lat1 = ((a[1] ?? 0) * Math.PI) / 180;
  const lng2 = ((b[0] ?? 0) * Math.PI) / 180;
  const lat2 = ((b[1] ?? 0) * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = lng2 - lng1;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Every coordinate ring in the geometry, so length and perimeter share one traversal.
function rings(geom: GeoJSON.Geometry): { rings: number[][][]; areal: boolean } {
  switch (geom.type) {
    case "LineString":
      return { rings: [geom.coordinates as number[][]], areal: false };
    case "MultiLineString":
      return { rings: geom.coordinates as number[][][], areal: false };
    case "Polygon":
      return { rings: geom.coordinates as number[][][], areal: true };
    case "MultiPolygon":
      return { rings: (geom.coordinates as number[][][][]).flat(), areal: true };
    default:
      return { rings: [], areal: false };
  }
}

/**
 * Haversine approximation of the importer's PostGIS geometry_size_m: geodesic length (or perimeter,
 * for areal geometry) capped by the bounding box, which keeps sprawling multi-part shapes from
 * reporting their summed extent. Bucket boundaries match the table-side query, so the diff is
 * meaningful even though individual sizes differ slightly from the PostGIS geography result.
 */
function geometrySizeM(geom: GeoJSON.Geometry): number | null {
  const { rings: parts, areal } = rings(geom);
  if (parts.length === 0) return null;

  let traversed = 0;
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;
  for (const ring of parts) {
    for (let i = 0; i < ring.length; i++) {
      if (i > 0) traversed += haversine(ring[i - 1]!, ring[i]!);
      const lng = ring[i]![0] ?? 0;
      const lat = ring[i]![1] ?? 0;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (traversed === 0) return 0;

  if (areal) {
    const width = haversine([minLng, minLat], [maxLng, minLat]);
    const height = haversine([minLng, minLat], [minLng, maxLat]);
    return Math.min(traversed, Math.max(width, height));
  }
  return Math.min(traversed, haversine([minLng, minLat], [maxLng, maxLat]));
}

function sizeBucket(size: number | null): string {
  if (size === null) return "(no geometry)";
  if (size < 500) return "< 500m";
  if (size < 2000) return "500m-2km";
  if (size < 10000) return "2km-10km";
  if (size < 50000) return "10km-50km";
  if (size < 200000) return "50km-200km";
  return "> 200km";
}

function sortDesc(dist: Distribution): Distribution {
  return Object.fromEntries(Object.entries(dist).sort((a, b) => b[1] - a[1]));
}

function collectGeojsonSnapshot(): Snapshot {
  const projectShape: Distribution = {};
  const timelineStatus: Distribution = {};
  const tags: Distribution = {};
  const tagsPerProject: Distribution = {};
  const geometrySize: Distribution = {};
  const osmIdTypes: Distribution = {};

  const seenIds = new Set<string>();
  let total = 0;
  let duplicateIds = 0;
  let hasName = 0,
    hasGeometry = 0,
    hasCentroid = 0,
    hasSourceUrl = 0;

  for (const geojsonPath of GEOJSON_PATHS) {
    if (!fs.existsSync(geojsonPath)) {
      console.error(`Missing ${geojsonPath}, skipping.`);
      continue;
    }
    const geojson = JSON.parse(fs.readFileSync(geojsonPath, "utf8")) as GeoJSON.FeatureCollection;

    for (const feature of geojson.features) {
      const externalId = feature.id ? String(feature.id) : null;
      // The upsert keys on (importSourceId, externalId), so repeats collapse into one row.
      if (externalId) {
        if (seenIds.has(externalId)) {
          duplicateIds++;
          continue;
        }
        seenIds.add(externalId);
      }
      total++;

      const props = feature.properties ?? {};

      bump(
        osmIdTypes,
        externalId === null
          ? "(user-submitted)"
          : externalId.startsWith("relation/")
            ? "relation"
            : externalId.startsWith("way/")
              ? "way"
              : "other",
      );

      const geom = feature.geometry as GeoJSON.Geometry | null;
      if (geom) {
        hasGeometry++;
        const isLine = geom.type === "LineString" || geom.type === "MultiLineString";
        const isPoly = geom.type === "Polygon" || geom.type === "MultiPolygon";
        bump(projectShape, isLine ? "linear" : isPoly ? "areal" : "other");
        bump(geometrySize, sizeBucket(geometrySizeM(geom)));
        if (centroid(geom)) hasCentroid++;
      } else {
        bump(projectShape, "(no geometry)");
        bump(geometrySize, "(no geometry)");
      }

      bump(timelineStatus, mapTimelineStatus(props["project_status"] as string | undefined));

      const featureTags = extractTags(props);
      for (const tag of featureTags) bump(tags, tag);
      bump(tagsPerProject, String(featureTags.length));

      if ((props["display_name"] as string | undefined)?.trim()) hasName++;
      if (deriveSourceUrl(props)) hasSourceUrl++;
    }
  }

  if (duplicateIds > 0) {
    console.error(`Note: ${duplicateIds} feature(s) repeat an external id and collapse on import.`);
  }

  tags["(no tags)"] = tagsPerProject["0"] ?? 0;

  return {
    timestamp: new Date().toISOString(),
    total,
    osm: total,
    userSubmitted: 0,
    detached: 0,
    projectShape: sortDesc(projectShape),
    // Imported features are auto-approved; the extract carries no other approval state.
    approvalStatus: { approved: total },
    timelineStatus: sortDesc(timelineStatus),
    tags: sortDesc(tags),
    tagsPerProject: Object.fromEntries(
      Object.entries(tagsPerProject).sort((a, b) => Number(a[0]) - Number(b[0])),
    ),
    countries: {},
    importSources: { osm_world: total },
    completeness: {
      name: hasName,
      geometry: hasGeometry,
      "lat/lng": hasCentroid,
      source_url: hasSourceUrl,
    },
    geometrySize,
    osmIdTypes: sortDesc(osmIdTypes),
  };
}

async function main() {
  const mode = process.argv[2] ?? "print";

  if (mode === "diff") {
    console.log("Collecting projects table state...");
    // Restrict the baseline to the rows this extract can account for. User submissions live in the
    // same table but no import touches them, so counting them would report them as losses.
    const before = await collectDbSnapshot(
      sql`import_source_id = (SELECT id FROM import_sources WHERE slug = 'osm_world')`,
    );
    console.log("Reading GeoJSON extract...");
    const after = collectGeojsonSnapshot();
    // Countries have no GeoJSON counterpart; carry the table's through so the section reports no
    // change instead of a total loss.
    after.countries = before.countries;
    printDiff(before, after, "projects table (before) vs GeoJSON extract (after)");
    return;
  }

  printSnapshot(collectGeojsonSnapshot(), "GeoJSON extract snapshot");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
