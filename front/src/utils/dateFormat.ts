/**
 * AI : Simple date formatting utility for consistent dd/mm/yyyy display across the app
 * No localization needed - uses plain numeric format
 */

import { dbToFlexibleDate, formatFlexibleDate } from "./flexibleDateHelpers";

/**
 * AI : Format a date as dd/mm/yyyy
 * @param date - Date object, string, or null/undefined
 * @returns Formatted date string or empty string if invalid
 */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "";

  const d = typeof date === "string" ? new Date(date) : date;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  return `${day}/${month}/${year}`;
}

/**
 * AI : Format a project date range based on timeline status
 * AI : Now supports flexible date precision
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
  // AI : If it's a proposed project, show "Proposed on {date}"
  if (proposalDate) {
    const proposalDateStr = formatFlexibleDate(
      dbToFlexibleDate(proposalDate, proposalDatePrecision),
    );
    return `${t("project.proposed")} ${proposalDateStr}`;
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

/**
 * AI : Format a date as relative time using i18n translations
 * @param date - The date to format (Date object or ISO string)
 * @param t - The vue-i18n translation function
 * @returns A human-readable relative time string
 */
export function formatRelativeTime(
  date: Date | string | null | undefined,
  t: (key: string, args?: Record<string, unknown>) => string,
): string {
  if (!date) {
    return t("common.unknown");
  }

  const now = new Date();
  const targetDate = typeof date === "string" ? new Date(date) : date;

  if (Number.isNaN(targetDate.getTime())) {
    return t("common.unknown");
  }

  const diffMs = now.getTime() - targetDate.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSeconds < 60) {
    return t("relativeTime.justNow");
  } else if (diffMinutes < 60) {
    return diffMinutes === 1
      ? t("relativeTime.minuteAgo", { count: diffMinutes })
      : t("relativeTime.minutesAgo", { count: diffMinutes });
  } else if (diffHours < 24) {
    return diffHours === 1
      ? t("relativeTime.hourAgo", { count: diffHours })
      : t("relativeTime.hoursAgo", { count: diffHours });
  } else if (diffDays < 7) {
    return diffDays === 1
      ? t("relativeTime.dayAgo", { count: diffDays })
      : t("relativeTime.daysAgo", { count: diffDays });
  } else if (diffWeeks < 4) {
    return diffWeeks === 1
      ? t("relativeTime.weekAgo", { count: diffWeeks })
      : t("relativeTime.weeksAgo", { count: diffWeeks });
  } else if (diffMonths < 12) {
    return diffMonths === 1
      ? t("relativeTime.monthAgo", { count: diffMonths })
      : t("relativeTime.monthsAgo", { count: diffMonths });
  } else {
    return diffYears === 1
      ? t("relativeTime.yearAgo", { count: diffYears })
      : t("relativeTime.yearsAgo", { count: diffYears });
  }
}
