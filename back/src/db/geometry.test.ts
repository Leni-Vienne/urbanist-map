import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { overlayGeometryValues, parseCoordinate, projectGeometryValues } from "./geometry";

const dialect = new PgDialect();

describe("geometry writes", () => {
  test("moving a footprint writes the center of the same four corners", () => {
    const corners = [
      { lat: 40, lng: 2 },
      { lat: 40, lng: 4 },
      { lat: 42, lng: 4 },
      { lat: 42, lng: 2 },
    ];
    const values = overlayGeometryValues(corners);
    expect(dialect.sqlToQuery(values.corners).params).toEqual([2, 40, 4, 40, 4, 42, 2, 42, 2, 40]);
    expect(dialect.sqlToQuery(values.centroid).params).toEqual([3, 41]);
  });

  test.each([
    { label: "null", value: null },
    { label: "empty", value: [] },
    { label: "one corner", value: [{ lat: 40, lng: 2 }] },
    { label: "NaN", value: Array.from({ length: 4 }, () => ({ lat: Number.NaN, lng: 2 })) },
    { label: "out of range", value: Array.from({ length: 4 }, () => ({ lat: 91, lng: 2 })) },
    { label: "string coordinate", value: Array.from({ length: 4 }, () => ({ lat: 40, lng: "2" })) },
  ])("rejects $label footprint before building SQL", ({ value }) => {
    expect(() => overlayGeometryValues(value)).toThrow();
  });

  test("clearing project shapes also clears their size", () => {
    expect(projectGeometryValues(null)).toEqual({ geometry: null, geometrySizeM: null });
  });

  test("uses the repaired project geometry to calculate its size", () => {
    const collection: GeoJSON.GeometryCollection = {
      type: "GeometryCollection",
      geometries: [
        {
          type: "LineString",
          coordinates: [
            [2, 40],
            [2.01, 40],
          ],
        },
      ],
    };
    const values = projectGeometryValues(collection);
    if (values.geometry === null) throw new Error("Missing geometry assignments");
    const shape = dialect.sqlToQuery(values.geometry);
    const size = dialect.sqlToQuery(values.geometrySizeM);
    expect(shape.sql).toContain("ST_MakeValid");
    expect(size.sql).toContain("ST_MakeValid");
    expect(shape.params).toEqual([JSON.stringify(collection)]);
    expect(size.params).toEqual(shape.params);
  });

  test("rejects unsupported project geometry and invalid legacy coordinates", () => {
    expect(() => projectGeometryValues({ type: "Point", coordinates: [2, 40] })).toThrow();
    expect(() => parseCoordinate({ lat: 40, lng: Number.POSITIVE_INFINITY })).toThrow();
  });
});
