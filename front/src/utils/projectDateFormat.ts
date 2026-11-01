import { dbToFlexibleDate, formatFlexibleDate } from "./flexibleDateHelpers";
import type { DatePrecision } from "@shared/types/flexibleDate";

interface ProjectDateFields {
  timelineStatus: string | null | undefined;
  startDate: Date | null | undefined;
  endDate: Date | null | undefined;
  proposalDate: Date | null | undefined;
  startDatePrecision?: DatePrecision | null;
  endDatePrecision?: DatePrecision | null;
  proposalDatePrecision?: DatePrecision | null;
}

/** Return the preferred project date/range and its translated label. */
export function formatProjectDateRangeParts(
  f: ProjectDateFields,
  t: (key: string) => string,
): { label: string; value: string } | null {
  if (f.timelineStatus === "proposed" && f.proposalDate) {
    return {
      label: t("project.proposalDate"),
      value: formatFlexibleDate(dbToFlexibleDate(f.proposalDate, f.proposalDatePrecision)),
    };
  }

  const start = f.startDate
    ? formatFlexibleDate(dbToFlexibleDate(f.startDate, f.startDatePrecision))
    : null;
  const end = f.endDate
    ? formatFlexibleDate(dbToFlexibleDate(f.endDate, f.endDatePrecision))
    : null;

  if (start && end) return { label: t("project.period"), value: `${start} - ${end}` };
  if (start) return { label: t("project.startDate"), value: start };
  if (end) return { label: t("project.estimatedCompletion"), value: end };
  if (f.proposalDate) {
    return {
      label: t("project.proposalDate"),
      value: formatFlexibleDate(dbToFlexibleDate(f.proposalDate, f.proposalDatePrecision)),
    };
  }

  return null;
}
