/**
 * Project-specific date formatting utilities that depend on flexible date precision.
 * Kept separate from dateFormat.ts to avoid pulling zod into the initial bundle.
 */

import { dbToFlexibleDate, formatFlexibleDate } from "./flexibleDateHelpers";

/**
 * Format a project date range based on timeline status
 * Supports flexible date precision (year, month, day)
 */
export function formatProjectDateRange(
  startDate: Date | null | undefined,
  endDate: Date | null | undefined,
  proposalDate: Date | null | undefined,
  startDatePrecision?: "year" | "month" | "day" | null,
  endDatePrecision?: "year" | "month" | "day" | null,
  proposalDatePrecision?: "year" | "month" | "day" | null,
  t = (key: string) => key,
): string {
  // If it's a proposed project, show "Proposed on/in {date}"
  // Use "proposedIn" for year/month precision, "proposedOn" for day (same pattern as startsIn/startsOn)
  if (proposalDate) {
    const proposalDateStr = formatFlexibleDate(
      dbToFlexibleDate(proposalDate, proposalDatePrecision),
    );
    const proposedKey =
      proposalDatePrecision === "day" || proposalDatePrecision === null
        ? "project.proposedOn"
        : "project.proposedIn";
    return `${t(proposedKey)} ${proposalDateStr}`;
  }

  const start = startDate
    ? formatFlexibleDate(dbToFlexibleDate(startDate, startDatePrecision))
    : null;
  const end = endDate ? formatFlexibleDate(dbToFlexibleDate(endDate, endDatePrecision)) : null;

  if (start && end) {
    return `${start} - ${end}`;
  } else if (start) {
    // Use "Starts in" for year/month precision, "Starts on" for day precision
    const startsKey = startDatePrecision === "day" ? "project.startsOn" : "project.startsIn";
    return `${t(startsKey)} ${start}`;
  } else if (end) {
    // Use "Ends in" for year/month precision, "Ends on" for day precision
    const endsKey = endDatePrecision === "day" ? "project.endsOn" : "project.endsIn";
    return `${t(endsKey)} ${end}`;
  }
  return "";
}
