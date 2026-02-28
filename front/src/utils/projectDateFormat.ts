/**
 * AI : Project-specific date formatting utilities that depend on flexible date precision.
 * AI : Kept separate from dateFormat.ts to avoid pulling zod into the initial bundle.
 */

import { dbToFlexibleDate, formatFlexibleDate } from "./flexibleDateHelpers";

/**
 * AI : Format a project date range based on timeline status
 * AI : Supports flexible date precision (year, month, day)
 * @param startDate - The start date of the project
 * @param endDate - The end date of the project
 * @param proposalDate - The proposal date (if project is proposed)
 * @param startDatePrecision - Precision level for start date (year, month, day)
 * @param endDatePrecision - Precision level for end date (year, month, day)
 * @param proposalDatePrecision - Precision level for proposal date (year, month, day)
 * @param t - The vue-i18n translation function
 * @returns A formatted date range string
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
  // AI : If it's a proposed project, show "Proposed on/in {date}"
  // AI : Use "proposedIn" for year/month precision, "proposedOn" for day (same pattern as startsIn/startsOn)
  if (proposalDate) {
    const proposalDateStr = formatFlexibleDate(
      dbToFlexibleDate(proposalDate, proposalDatePrecision),
    );
    const proposedKey =
      proposalDatePrecision === "day" ? "project.proposedOn" : "project.proposedIn";
    return `${t(proposedKey)} ${proposalDateStr}`;
  }

  const start = startDate
    ? formatFlexibleDate(dbToFlexibleDate(startDate, startDatePrecision))
    : null;
  const end = endDate ? formatFlexibleDate(dbToFlexibleDate(endDate, endDatePrecision)) : null;

  if (start && end) {
    return `${start} - ${end}`;
  } else if (start) {
    // AI : Use "Starts in" for year/month precision, "Starts on" for day precision
    const startsKey = startDatePrecision === "day" ? "project.startsOn" : "project.startsIn";
    return `${t(startsKey)} ${start}`;
  } else if (end) {
    // AI : Use "Ends in" for year/month precision, "Ends on" for day precision
    const endsKey = endDatePrecision === "day" ? "project.endsOn" : "project.endsIn";
    return `${t(endsKey)} ${end}`;
  }
  return "";
}
