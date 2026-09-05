import { describe, expect, test } from "bun:test";
import { projectDataLayersBottomId } from "./layerOrder";

describe("projectDataLayersBottomId", () => {
  test("selects pending geometry when it is below approved geometry", () => {
    expect(
      projectDataLayersBottomId([
        { id: "basemap-labels" },
        { id: "pending-project-shapes-fill" },
        { id: "project-shapes-fill" },
      ]),
    ).toBe("pending-project-shapes-fill");
  });

  test("falls back to approved geometry", () => {
    expect(projectDataLayersBottomId([{ id: "project-shapes-fill" }])).toBe("project-shapes-fill");
  });
});
