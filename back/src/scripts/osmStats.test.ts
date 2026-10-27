import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("GeoJSON stats emit a JSON snapshot without requiring database configuration", () => {
  const directory = mkdtempSync(join(tmpdir(), "osm-stats-"));
  try {
    const dataDirectory = join(directory, "scripts/osm-extract");
    mkdirSync(dataDirectory, { recursive: true });
    const feature = {
      type: "Feature",
      id: "way/1",
      geometry: {
        type: "LineString",
        coordinates: [
          [2, 48],
          [2.001, 48],
        ],
      },
      properties: {
        display_name: "Example line",
        transport_type: "rail",
        project_status: "planned",
      },
    };
    for (const kind of ["linear", "areal"]) {
      const features = kind === "linear" ? [feature, feature] : [];
      writeFileSync(
        join(dataDirectory, `planet-latest_proposed_${kind}.geojson`),
        JSON.stringify({ type: "FeatureCollection", features }),
      );
    }
    const result = spawnSync(process.execPath, [join(import.meta.dir, "stats-osm-geojson.ts")], {
      cwd: directory,
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, DATABASE_URL: "invalid" },
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      component: "osm_stats",
      event: "stats_snapshot",
      total: 1,
      projectShape: { linear: 1 },
      timelineStatus: { planned: 1 },
      completeness: { name: 1, geometry: 1 },
    });
    expect(JSON.parse(result.stderr.trim())).toMatchObject({
      event: "duplicate_ids",
      duplicates: 1,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
