import { afterEach, describe, expect, test } from "bun:test";
import {
  lastModifiedDateRange,
  matchesProjectFilters,
  selectedNameFilter,
  selectedProjectTags,
  selectedStatusFilters,
  showOnlyWithImages,
  sizeFilterRange,
  toggleNameFilter,
  UNTAGGED_PROJECT_FILTER,
  type FilterableProject,
} from "./filters";

const project: FilterableProject = {
  tags: ["rail"],
  timelineStatus: "planned",
  name: "Metro",
  geometrySizeM: 1000,
  lastModifiedMs: 2000,
  hasImage: true,
};

afterEach(() => {
  selectedProjectTags.value = [];
  selectedStatusFilters.value = [];
  selectedNameFilter.value = null;
  sizeFilterRange.value = [0, Infinity];
  lastModifiedDateRange.value = [0, Infinity];
  showOnlyWithImages.value = false;
});

describe("matchesProjectFilters", () => {
  test("matches every project when no filter is active", () => {
    expect(matchesProjectFilters({ hasImage: false })).toBeTrue();
  });

  test("uses OR within tag selections", () => {
    selectedProjectTags.value = ["road", "rail"];
    expect(matchesProjectFilters(project)).toBeTrue();
  });

  test("treats missing tags as untagged", () => {
    selectedProjectTags.value = [UNTAGGED_PROJECT_FILTER];
    expect(matchesProjectFilters({ ...project, tags: null })).toBeTrue();
    expect(matchesProjectFilters(project)).toBeFalse();
  });

  test("rejects unknown statuses and blank names under explicit filters", () => {
    selectedStatusFilters.value = ["planned"];
    selectedNameFilter.value = "named";
    expect(matchesProjectFilters({ ...project, timelineStatus: null })).toBeFalse();
    expect(matchesProjectFilters({ ...project, name: "  " })).toBeFalse();
  });

  test("keeps the name choices mutually exclusive", () => {
    toggleNameFilter("named");
    toggleNameFilter("unnamed");
    expect(selectedNameFilter.value).toBe("unnamed");
    toggleNameFilter("unnamed");
    expect(selectedNameFilter.value).toBeNull();
  });

  test("rejects missing values when a range is active", () => {
    sizeFilterRange.value = [500, Infinity];
    expect(matchesProjectFilters({ ...project, geometrySizeM: null })).toBeFalse();
    expect(matchesProjectFilters(project)).toBeTrue();

    sizeFilterRange.value = [0, Infinity];
    lastModifiedDateRange.value = [1500, 2500];
    expect(matchesProjectFilters({ ...project, lastModifiedMs: Number.NaN })).toBeFalse();
    expect(matchesProjectFilters(project)).toBeTrue();
  });

  test("requires an image only when requested", () => {
    showOnlyWithImages.value = true;
    expect(matchesProjectFilters({ ...project, hasImage: false })).toBeFalse();
    expect(matchesProjectFilters(project)).toBeTrue();
  });
});
