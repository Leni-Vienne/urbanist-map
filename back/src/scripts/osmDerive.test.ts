import { describe, expect, test } from "bun:test";
import { extractTags, shouldSkipUnchangedOsmFeature } from "./osmDerive";
import { extractTagsFromOsmProperties, formatConstructionName } from "@shared/osmRules";

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

  test("uses the same fallback for frontend OSM properties", () => {
    expect(
      extractTagsFromOsmProperties([{ construction: "museum", landuse: "construction" }]),
    ).toEqual(["construction"]);
  });

  test("turns a meaningful subtype into a display label", () => {
    expect(formatConstructionName("museum")).toBe("Museum");
    expect(formatConstructionName("sports_centre")).toBe("Sports centre");
    expect(formatConstructionName("yes")).toBeNull();
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
