import { describe, expect, test } from "bun:test";
import { computeOsmFeatureRevision, shouldSkipOsmFeature } from "./osmRevision";

describe("computeOsmFeatureRevision", () => {
  test("ignores JSON object key order", () => {
    const first = feature({
      display_name: "Line A",
      relation: { type: "route", ref: "A" },
    });
    const reordered = feature({
      relation: { ref: "A", type: "route" },
      display_name: "Line A",
    });

    expect(computeOsmFeatureRevision(first)).toBe(computeOsmFeatureRevision(reordered));
  });

  test("normalizes unordered osm_ids", () => {
    const first = feature({ osm_ids: ["way/20", "way/3", "way/10"] });
    const reordered = feature({ osm_ids: ["way/10", "way/20", "way/3"] });

    expect(computeOsmFeatureRevision(first)).toBe(computeOsmFeatureRevision(reordered));
  });

  test("preserves order for arrays without an unordered contract", () => {
    const first = feature({ stops: ["west", "central", "east"] });
    const reordered = feature({ stops: ["east", "central", "west"] });

    expect(computeOsmFeatureRevision(first)).not.toBe(computeOsmFeatureRevision(reordered));
  });

  test("changes when osm_ids membership changes", () => {
    const original = feature({ osm_ids: ["way/10", "way/20"] });
    const added = feature({ osm_ids: ["way/10", "way/20", "way/30"] });
    const removed = feature({ osm_ids: ["way/10"] });

    expect(computeOsmFeatureRevision(added)).not.toBe(computeOsmFeatureRevision(original));
    expect(computeOsmFeatureRevision(removed)).not.toBe(computeOsmFeatureRevision(original));
  });

  test("changes when relation-derived properties change", () => {
    const original = feature({ display_name: "Relation name", project_status: "proposed" });
    const changed = feature({
      display_name: "Renamed relation",
      project_status: "under_construction",
    });

    expect(computeOsmFeatureRevision(changed)).not.toBe(computeOsmFeatureRevision(original));
  });

  test("changes when coordinates change", () => {
    const original = feature({}, [2.1, 48.8]);
    const changed = feature({}, [2.1001, 48.8]);

    expect(computeOsmFeatureRevision(changed)).not.toBe(computeOsmFeatureRevision(original));
  });

  test("changes when the feature ID changes", () => {
    const original = feature({});
    const changed = { ...original, id: "relation/124" };

    expect(computeOsmFeatureRevision(changed)).not.toBe(computeOsmFeatureRevision(original));
  });
});

describe("shouldSkipOsmFeature", () => {
  test("processes a row without a stored revision", () => {
    expect(shouldSkipOsmFeature(null, "incoming", false)).toBe(false);
  });

  test("skips a matching revision", () => {
    expect(shouldSkipOsmFeature("same", "same", false)).toBe(true);
  });

  test("processes a matching revision during a full reimport", () => {
    expect(shouldSkipOsmFeature("same", "same", true)).toBe(false);
  });
});

function feature(properties: Record<string, unknown>, coordinate = [2.1, 48.8]) {
  return {
    type: "Feature" as const,
    id: "relation/123",
    properties,
    geometry: {
      type: "LineString" as const,
      coordinates: [coordinate, [2.2, 48.9]],
    },
  };
}
