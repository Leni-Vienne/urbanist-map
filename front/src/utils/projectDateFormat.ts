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
  timelineStatus: string | null | undefined,
  startDate: Date | null | undefined,
  endDate: Date | null | undefined,
  proposalDate: Date | null | undefined,
  startDatePrecision?: "year" | "month" | "day" | null,
  endDatePrecision?: "year" | "month" | "day" | null,
  proposalDatePrecision?: "year" | "month" | "day" | null,
  t = (key: string) => key,
): string {
  // If it's proposed or canceled, the proposal date is most relevant
  if (timelineStatus === "proposed" && proposalDate) {
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
    const startsKey =
      startDatePrecision === "day" || startDatePrecision === null
        ? "project.startsOn"
        : "project.startsIn";
    return `${t(startsKey)} ${start}`;
  } else if (end) {
    // Use "Ends in" for year/month precision, "Ends on" for day precision
    const endsKey =
      endDatePrecision === "day" || endDatePrecision === null ? "project.endsOn" : "project.endsIn";
    return `${t(endsKey)} ${end}`;
  } else if (proposalDate) {
    // Fallback if we only have proposal date but status is not proposed
    const proposalDateStr = formatFlexibleDate(
      dbToFlexibleDate(proposalDate, proposalDatePrecision),
    );
    const proposedKey =
      proposalDatePrecision === "day" || proposalDatePrecision === null
        ? "project.proposedOn"
        : "project.proposedIn";
    return `${t(proposedKey)} ${proposalDateStr}`;
  }

  return "";
}
