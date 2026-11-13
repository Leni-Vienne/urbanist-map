import type { DatePrecision } from "./types/flexibleDate";

interface ProjectDateFields {
  timelineStatus?: string | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  proposalDate?: Date | string | null;
  startDatePrecision?: DatePrecision | null;
  endDatePrecision?: DatePrecision | null;
  proposalDatePrecision?: DatePrecision | null;
}

export function formatStoredDate(
  value: Date | string | null | undefined,
  precision: DatePrecision | null | undefined,
  locale: string,
): string {
  if (value === null || value === undefined) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  if (precision === "year") return String(date.getUTCFullYear());
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    ...(precision !== "month" && { day: "numeric" }),
    timeZone: "UTC",
  }).format(date);
}

/** Choose proposal/period/start/end consistently across the app and the SEO shell. */
export function formatProjectDateRangeParts(
  fields: ProjectDateFields,
  label: (key: string) => string,
  locale: string,
): { label: string; value: string } | null {
  const proposal = formatStoredDate(fields.proposalDate, fields.proposalDatePrecision, locale);
  if (fields.timelineStatus === "proposed" && proposal) {
    return { label: label("project.proposalDate"), value: proposal };
  }
  const start = formatStoredDate(fields.startDate, fields.startDatePrecision, locale);
  const end = formatStoredDate(fields.endDate, fields.endDatePrecision, locale);
  if (start && end) return { label: label("project.period"), value: `${start} - ${end}` };
  if (start) return { label: label("project.startDate"), value: start };
  if (end) return { label: label("project.estimatedCompletion"), value: end };
  return proposal ? { label: label("project.proposalDate"), value: proposal } : null;
}
