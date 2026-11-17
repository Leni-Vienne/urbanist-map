import { afterEach, describe, expect, test } from "bun:test";
import {
  dateSliderPositions,
  DATE_SLIDER_MAX,
  posToMs,
  matchesProjectFilters,
  selectedNameFilter,
  selectedProjectTags,
  selectedStatusFilters,
  showOnlyWithImages,
  sizeSliderPositions,
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
  sizeSliderPositions.value = [0, 100];
  dateSliderPositions.value = [0, DATE_SLIDER_MAX];
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
    sizeSliderPositions.value = [50, 100];
    expect(matchesProjectFilters({ ...project, geometrySizeM: null })).toBeFalse();
    expect(matchesProjectFilters(project)).toBeTrue();

    sizeSliderPositions.value = [0, 100];
    dateSliderPositions.value = [50, DATE_SLIDER_MAX];
    expect(matchesProjectFilters({ ...project, lastModifiedMs: Number.NaN })).toBeFalse();
    expect(matchesProjectFilters({ ...project, lastModifiedMs: posToMs(75) })).toBeTrue();
  });

  test("requires an image only when requested", () => {
    showOnlyWithImages.value = true;
    expect(matchesProjectFilters({ ...project, hasImage: false })).toBeFalse();
    expect(matchesProjectFilters(project)).toBeTrue();
  });
});
