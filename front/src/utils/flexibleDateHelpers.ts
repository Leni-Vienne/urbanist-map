import type { FlexibleDateInput, DatePrecision } from "@shared/types/flexibleDate";

/** Convert a Date to a FlexibleDateInput at the given precision. */
function dateToFlexibleInput(date: Date, precision: DatePrecision = "day"): FlexibleDateInput {
  return {
    year: date.getFullYear(),
    month: precision !== "year" ? date.getMonth() + 1 : undefined,
    day: precision === "day" ? date.getDate() : undefined,
    precision,
  };
}

/**
 * Convert a standard Date object (from DB) to FlexibleDateInput (for form)
 * Uses the precision stored in the DB. Falls back to "day" if not available
 * (e.g. for legacy records created before the precision column was added).
 */
export function dbToFlexibleDate(
  date: Date | null | undefined,
  savedPrecision: DatePrecision | null = null,
): FlexibleDateInput | null {
  if (!date) return null;

  // Use precision stored in DB, or fall back to "day" for legacy records
  return dateToFlexibleInput(date, savedPrecision ?? "day");
}

/**
 * Convert FlexibleDateInput back to a standard Date for DB storage
 * This normalizes partial dates to a specific point in time
 * Year -> Jan 1st
 * Month -> 1st of month
 */
export function flexibleDateToDb(input: FlexibleDateInput | null | undefined): Date | null {
  if (!input) return null;

  const { year, month = 1, day = 1 } = input;
  return new Date(year, month - 1, day);
}

/**
 * Format a flexible date for display with localization
 */
export function formatFlexibleDate(
  input: FlexibleDateInput | null | undefined,
  locale?: string, // Optional locale override, otherwise uses navigator.language
): string {
  if (!input) return "";

  const { year, month, day, precision } = input;
  const userLocale = locale ?? navigator.language;

  // Create a date object for formatting
  // Use noon to avoid timezone rollover issues with basic dates
  const date = new Date(year, (month ?? 1) - 1, day ?? 1, 12, 0, 0);

  if (precision === "year") {
    return year.toString();
  }

  if (precision === "month") {
    return new Intl.DateTimeFormat(userLocale, { year: "numeric", month: "long" }).format(date);
  }

  return new Intl.DateTimeFormat(userLocale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}
