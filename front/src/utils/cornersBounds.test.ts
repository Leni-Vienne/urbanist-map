import { describe, expect, test } from "bun:test";
import { buildShapeBounds } from "./cornersBounds";

describe("buildShapeBounds", () => {
  test("combines nested shapes and ignores point markers and altitude", () => {
    const bounds = buildShapeBounds(
      {
        type: "GeometryCollection",
        geometries: [
          { type: "Point", coordinates: [100, 80] },
          {
            type: "GeometryCollection",
            geometries: [
              {
                type: "LineString",
                coordinates: [
                  [2, 3, 200],
                  [4, 5, 400],
                ],
              },
            ],
          },
        ],
      },
      null,
      {
        type: "GeometryCollection",
        geometries: [
          {
            type: "MultiLineString",
            coordinates: [
              [
                [1, 2],
                [6, 7],
              ],
            ],
          },
        ],
      },
    );
    expect(bounds?.toArray()).toEqual([
      [1, 2],
      [6, 7],
    ]);
    expect(buildShapeBounds(null, { type: "GeometryCollection", geometries: [] })).toBeNull();
    expect(
      buildShapeBounds({
        type: "GeometryCollection",
        geometries: [{ type: "Point", coordinates: [2, 3] }],
      }),
    ).toBeNull();
  });
});
