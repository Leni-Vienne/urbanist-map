import { describe, expect, test } from "bun:test";
import { decodeRenderImagePin } from "./renderImagePin";

function feature(
  properties: Record<string, unknown> = {},
): Parameters<typeof decodeRenderImagePin>[0] {
  return {
    geometry: { type: "Point", coordinates: [2.35, 48.85] },
    properties: { id: "project-1", render_filename: "render.webp", cell_count: 1, ...properties },
  };
}

describe("render image pins", () => {
  test("builds a thumbnail and full image for an individual project", () => {
    const pin = decodeRenderImagePin(feature({ name: "Project", first_tag: "residential" }));
    expect(pin?.projectId).toBe("project-1");
    expect(pin?.name).toBe("Project");
    expect(pin?.coordinates).toEqual([2.35, 48.85]);
    expect(pin?.thumbnailUrl).toEndWith("/uploads/thumbnails/render.webp");
    expect(pin?.imageUrl).toEndWith("/uploads/render.webp");
  });

  test("keeps cluster representatives as clusters even if they have a render", () => {
    expect(decodeRenderImagePin(feature({ cell_count: 4 }))).toBeNull();
  });

  test("leaves ordinary projects and malformed image metadata as dots", () => {
    for (const render_filename of [undefined, null, "", 42]) {
      expect(decodeRenderImagePin(feature({ render_filename }))).toBeNull();
    }
    expect(decodeRenderImagePin(feature({ id: "" }))).toBeNull();
  });

  test("visible project shapes keep their render at the explicit project center", () => {
    const shape = feature({ cell_count: undefined, render_lng: 2.36, render_lat: 48.86 });
    shape.geometry = {
      type: "Polygon",
      coordinates: [
        [
          [2, 48],
          [3, 48],
          [3, 49],
          [2, 48],
        ],
      ],
    };
    expect(decodeRenderImagePin(shape)?.coordinates).toEqual([2.36, 48.86]);
    expect(decodeRenderImagePin(shape)?.projectId).toBe("project-1");
    shape.geometry = {
      type: "LineString",
      coordinates: [
        [2, 48],
        [3, 49],
      ],
    };
    expect(decodeRenderImagePin(shape)?.coordinates).toEqual([2.36, 48.86]);
  });

  test("rejects shapes without a valid project center", () => {
    const shape = feature({ render_lng: 2.36, render_lat: null });
    shape.geometry = {
      type: "Polygon",
      coordinates: [
        [
          [2, 48],
          [3, 48],
          [3, 49],
          [2, 48],
        ],
      ],
    };
    expect(decodeRenderImagePin(shape)).toBeNull();
    shape.properties.render_lat = Number.NaN;
    expect(decodeRenderImagePin(shape)).toBeNull();
  });

  test("rejects invalid point positions and shapes without center metadata", () => {
    const invalid = feature();
    invalid.geometry = { type: "Point", coordinates: [Number.NaN, 48] };
    expect(decodeRenderImagePin(invalid)).toBeNull();
    invalid.geometry = {
      type: "LineString",
      coordinates: [
        [2, 48],
        [3, 49],
      ],
    };
    expect(decodeRenderImagePin(invalid)).toBeNull();
  });
});
