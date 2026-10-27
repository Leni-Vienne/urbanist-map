import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

for (const missing of ["linear", "areal"]) {
  test(`missing ${missing} input stops the worldwide sync before database work`, () => {
    const directory = mkdtempSync(join(tmpdir(), "osm-import-"));
    try {
      const prefix = join(directory, "worldwide extract_proposed");
      const present = missing === "linear" ? "areal" : "linear";
      writeFileSync(`${prefix}_${present}.geojson`, '{"type":"FeatureCollection","features":[]}');

      const result = spawnSync(
        process.execPath,
        [join(import.meta.dir, "import-osm.ts"), "--input-prefix", prefix, "--full"],
        {
          cwd: directory,
          encoding: "utf8",
          timeout: 10_000,
          env: {
            ...process.env,
            DATABASE_URL: "postgres://test:test@127.0.0.1:1/test",
            CORS_ORIGIN: "http://localhost",
            COOKIE_SECRET: "osm-import-test-secret-not-for-production",
          },
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`${prefix}_${missing}.geojson`);
      expect(result.stdout).toBe("");
      const records = result.stderr
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        component: "import_osm",
        event: "import_failed",
        level: "error",
      });
      expect(records[0].error.message).toContain(`${prefix}_${missing}.geojson`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
