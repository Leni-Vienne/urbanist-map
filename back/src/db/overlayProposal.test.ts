import { describe, expect, test } from "bun:test";
import { buildOwnOverlayProposal } from "./overlayProposal";

describe("own overlay proposal", () => {
  test("distinguishes no request from a request to clear the caption", () => {
    expect(buildOwnOverlayProposal([])).toBeUndefined();
    expect(buildOwnOverlayProposal([{ fieldName: "caption", newValue: null }])).toEqual({
      caption: null,
    });
  });

  test("preserves both proposed fields without inventing a caption change", () => {
    const corners = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 1, lng: 1 },
      { lat: 1, lng: 0 },
    ];
    expect(buildOwnOverlayProposal([{ fieldName: "corners", newValue: corners }])).toEqual({
      corners,
    });
    expect(
      buildOwnOverlayProposal([
        { fieldName: "corners", newValue: corners },
        { fieldName: "caption", newValue: "Proposed caption" },
      ]),
    ).toEqual({ corners, caption: "Proposed caption" });
  });

  test("retains the existence of legacy requests without treating them as caption removals", () => {
    expect(
      buildOwnOverlayProposal([{ fieldName: "centroid", newValue: { lat: 0, lng: 0 } }]),
    ).toEqual({});
  });

  test("does not expose malformed corners as editable geometry", () => {
    expect(
      buildOwnOverlayProposal([
        { fieldName: "corners", newValue: [{ lat: "invalid", lng: 0 }] },
        { fieldName: "caption", newValue: null },
      ]),
    ).toEqual({ caption: null });
  });
});
