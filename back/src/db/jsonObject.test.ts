import { describe, expect, test } from "bun:test";
import { projects } from "./schema";

const column = projects.externalProperties;

describe("project external properties", () => {
  const properties = {
    wikidata: "Q3240151",
    wikipedia: "fr:Ligne 15 du métro de Paris",
    osm_ids: ["way/541784211"],
    nested: { colour: "#a50034" },
  };

  test("reads an ordinary jsonb object", () => {
    expect(column.mapFromDriverValue(properties)).toEqual(properties);
  });

  test("reads a jsonb string containing serialized OSM properties", () => {
    expect(column.mapFromDriverValue(JSON.stringify(properties))).toEqual(properties);
  });

  test.each(
    [null, undefined, "not JSON", "[]", "null", "42", '"text"', [], 42].map((value) => ({
      label: value === undefined ? "undefined" : JSON.stringify(value),
      value,
    })),
  )("treats $label as absent object metadata", ({ value }) => {
    expect(column.mapFromDriverValue(value)).toBeNull();
  });
});
