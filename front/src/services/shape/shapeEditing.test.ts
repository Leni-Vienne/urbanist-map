import { describe, expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { loadGeoJSONFile } from "./shapeEditing";

describe("loadGeoJSONFile", () => {
  test("imports drawable features and reports skipped points", async () => {
    const line = {
      type: "LineString",
      coordinates: [
        [2, 3],
        [4, 5],
      ],
    } satisfies GeoJSON.LineString;
    const file = new File(
      [
        JSON.stringify({
          type: "FeatureCollection",
          features: [
            { type: "Feature", properties: {}, geometry: line },
            { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [2, 3] } },
            { type: "Feature", properties: {}, geometry: null },
          ],
        }),
      ],
      "shapes.geojson",
    );
    const loaded = await loadGeoJSONFile(file);
    expect(loaded.geometry.geometries).toEqual([line]);
    expect(loaded.skippedGeometryTypes).toEqual(["Point"]);
  });

  test("rejects malformed geometry at file import", async () => {
    await rejects(
      loadGeoJSONFile(
        new File(
          [
            JSON.stringify({
              type: "GeometryCollection",
              geometries: [{ type: "LineString", coordinates: null }],
            }),
          ],
          "broken.geojson",
        ),
      ),
      { message: 'Invalid GeoJSON in file "broken.geojson"' },
    );
    await rejects(loadGeoJSONFile(new File(["{"], "broken.json")), {
      message: 'Invalid JSON in file "broken.json"',
    });
  });
});
