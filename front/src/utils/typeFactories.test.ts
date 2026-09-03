import { describe, expect, test } from "bun:test";
import { createLocalProject, hydratedProjectFromWire } from "./typeFactories";

describe("hydratedProjectFromWire", () => {
  test("retains the backend image order as project detail membership", () => {
    const { status: _status, ...project } = createLocalProject({ id: "project-1" });

    const hydrated = hydratedProjectFromWire({
      ...project,
      status: "approved",
      tags: null,
      slug: "project-1",
      render: null,
      mapOverlays: [
        { id: "older", filename: "older.webp", caption: "Older" },
        { id: "newer", filename: "newer.webp", caption: null },
      ],
      ownerUsername: null,
      boundaryPath: [],
    });

    expect(hydrated.mapOverlays.map((overlay) => overlay.id)).toEqual(["older", "newer"]);
    expect(hydrated.tags).toEqual([]);
  });
});
