/**
 * Project-specific date formatting utilities that depend on flexible date precision.
 * Kept separate from dateFormat.ts to avoid pulling zod into the initial bundle.
 */

import { dbToFlexibleDate, formatFlexibleDate } from "./flexibleDateHelpers";

type DatePrecision = "year" | "month" | "day" | null | undefined;

export interface ProjectDateFields {
  timelineStatus: string | null | undefined;
  startDate: Date | null | undefined;
  endDate: Date | null | undefined;
  proposalDate: Date | null | undefined;
  startDatePrecision?: DatePrecision;
  endDatePrecision?: DatePrecision;
  proposalDatePrecision?: DatePrecision;
}

type ResolvedDateRange =
  | { kind: "proposed"; value: string; precision: DatePrecision }
  | { kind: "period"; start: string; end: string }
  | { kind: "start"; value: string; precision: DatePrecision }
  | { kind: "end"; value: string; precision: DatePrecision }
  | { kind: "none" };

// Resolve which date(s) a project row should show. Shared by both formatters below so the
// proposed/period/start/end priority lives in one place.
function resolveProjectDateRange(f: ProjectDateFields): ResolvedDateRange {
  if (f.timelineStatus === "proposed" && f.proposalDate) {
    return {
      kind: "proposed",
      value: formatFlexibleDate(dbToFlexibleDate(f.proposalDate, f.proposalDatePrecision)),
      precision: f.proposalDatePrecision,
    };
  }

  const start = f.startDate
    ? formatFlexibleDate(dbToFlexibleDate(f.startDate, f.startDatePrecision))
    : null;
  const end = f.endDate
    ? formatFlexibleDate(dbToFlexibleDate(f.endDate, f.endDatePrecision))
    : null;

  if (start && end) return { kind: "period", start, end };
  if (start) return { kind: "start", value: start, precision: f.startDatePrecision };
  if (end) return { kind: "end", value: end, precision: f.endDatePrecision };
  if (f.proposalDate) {
    return {
      kind: "proposed",
      value: formatFlexibleDate(dbToFlexibleDate(f.proposalDate, f.proposalDatePrecision)),
      precision: f.proposalDatePrecision,
    };
  }

  return { kind: "none" };
}

/**
 * Returns a separate label and value for use in labeled UI rows.
 * The label is descriptive ("Estimated Completion", "Period", etc.)
 * and the value is just the date/range without a verb prefix.
 */
export function formatProjectDateRangeParts(
  fields: ProjectDateFields,
  t: (key: string) => string,
): { label: string; value: string } | null {
  const resolved = resolveProjectDateRange(fields);
  switch (resolved.kind) {
    case "proposed":
      return { label: t("project.proposalDate"), value: resolved.value };
    case "period":
      return { label: t("project.period"), value: `${resolved.start} - ${resolved.end}` };
    case "start":
      return { label: t("project.startDate"), value: resolved.value };
    case "end":
      return { label: t("project.estimatedCompletion"), value: resolved.value };
    default:
      return null;
  }
}
