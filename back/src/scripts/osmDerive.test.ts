import { describe, expect, test } from "bun:test";
import { extractTags, shouldSkipUnchangedOsmFeature } from "./osmDerive";
import { formatConstructionName, isRedevelopmentSite } from "@shared/osmRules";

describe("OSM construction fallback tag", () => {
  test("tags a bare construction landuse", () => {
    expect(extractTags({ landuse: "construction" })).toEqual(["construction"]);
  });

  test("tags an unsupported construction subtype", () => {
    expect(extractTags({ construction: "museum", landuse: "construction" })).toEqual([
      "construction",
    ]);
  });

  test("keeps a more specific supported tag instead", () => {
    expect(
      extractTags({
        building_category: "residential",
        construction: "apartments",
        landuse: "construction",
      }),
    ).toEqual(["residential", "building"]);
  });

  test("turns a meaningful subtype into a display label", () => {
    expect(formatConstructionName("museum")).toBe("Museum");
    expect(formatConstructionName("sports_centre")).toBe("Sports centre");
    expect(formatConstructionName("yes")).toBeNull();
  });
});

describe("OSM area extraction categories", () => {
  test("keeps unspecified planned developments filterable without borrowing current landuse", () => {
    expect(
      extractTags({
        transport_type: "building",
        project_status: "planned",
        "planned:landuse": "yes",
        landuse: "retail",
      }),
    ).toEqual(["building"]);
  });

  test("uses the extractor classification for newly supported development uses", () => {
    expect(extractTags({ transport_type: "building", "planned:landuse": "education" })).toEqual([
      "building",
    ]);
  });

  test("generic lifecycle flags do not turn the current park into the future development", () => {
    expect(
      extractTags({
        transport_type: "building",
        "planned:landuse": "yes",
        planned: "yes",
        leisure: "park",
      }),
    ).toEqual(["building"]);
  });

  test("generic flags without an area target still use the primary feature", () => {
    expect(isRedevelopmentSite({ planned: "yes", highway: "primary", "planned:lanes": "4" })).toBe(
      false,
    );
    expect(
      isRedevelopmentSite({ landuse: "construction", "construction:building": "apartments" }),
    ).toBe(false);
  });

  test("keeps recreation projects in the park category", () => {
    expect(
      extractTags({
        transport_type: "park",
        "planned:landuse": "recreation_ground",
        landuse: "retail",
      }),
    ).toEqual(["park"]);
  });

  test("preserves a specific future use and the existing construction fallback", () => {
    expect(
      extractTags({
        transport_type: "building",
        building_category: "residential",
        "planned:landuse": "residential",
        landuse: "retail",
      }),
    ).toEqual(["residential", "building"]);
    expect(extractTags({ transport_type: "building", construction: "museum" })).toEqual([
      "construction",
    ]);
  });
});

describe("OSM unchanged-row skipping", () => {
  const timestamp = new Date("2026-02-04T14:36:17Z");

  test("skips the first unchanged occurrence", () => {
    expect(
      shouldSkipUnchangedOsmFeature({
        fullReimport: false,
        externalId: "relation/14721596",
        osmLastModified: timestamp,
        storedLastModifiedMs: timestamp.getTime(),
        encounteredInRun: false,
      }),
    ).toBe(true);
  });

  test("does not skip a later duplicate occurrence", () => {
    expect(
      shouldSkipUnchangedOsmFeature({
        fullReimport: false,
        externalId: "relation/14721596",
        osmLastModified: timestamp,
        storedLastModifiedMs: timestamp.getTime(),
        encounteredInRun: true,
      }),
    ).toBe(false);
  });
});
