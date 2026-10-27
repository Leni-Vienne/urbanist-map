import { logOsmEvent } from "./osmLog";

export type Distribution = Record<string, number>;

export interface Snapshot {
  timestamp: string;
  total: number;
  osm: number;
  userSubmitted: number;
  detached: number;
  projectShape: Distribution;
  approvalStatus: Distribution;
  timelineStatus: Distribution;
  tags: Distribution;
  tagsPerProject: Distribution;
  countries: Distribution;
  importSources: Distribution;
  completeness: Distribution;
  geometrySize: Distribution;
  osmIdTypes: Distribution;
}

export function printSnapshot(snapshot: Snapshot, title = "projects table snapshot"): void {
  logOsmEvent("osm_stats", "stats_snapshot", { title, ...snapshot });
}

function diffDistribution(before: Distribution, after: Distribution): Distribution {
  const delta: Distribution = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    delta[key] = (after[key] ?? 0) - (before[key] ?? 0);
  }
  return delta;
}

export function printDiff(before: Snapshot, after: Snapshot, title = "projects table diff"): void {
  logOsmEvent("osm_stats", "stats_diff", {
    title,
    before,
    after,
    delta: {
      total: after.total - before.total,
      osm: after.osm - before.osm,
      userSubmitted: after.userSubmitted - before.userSubmitted,
      detached: after.detached - before.detached,
      projectShape: diffDistribution(before.projectShape, after.projectShape),
      approvalStatus: diffDistribution(before.approvalStatus, after.approvalStatus),
      timelineStatus: diffDistribution(before.timelineStatus, after.timelineStatus),
      tags: diffDistribution(before.tags, after.tags),
      tagsPerProject: diffDistribution(before.tagsPerProject, after.tagsPerProject),
      countries: diffDistribution(before.countries, after.countries),
      importSources: diffDistribution(before.importSources, after.importSources),
      osmIdTypes: diffDistribution(before.osmIdTypes, after.osmIdTypes),
      completeness: diffDistribution(before.completeness, after.completeness),
      geometrySize: diffDistribution(before.geometrySize, after.geometrySize),
    },
  });
}
