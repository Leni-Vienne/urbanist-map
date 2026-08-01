import type { FlexibleDateInput, DatePrecision } from "@shared/types/flexibleDate";

/** Convert a Date to a FlexibleDateInput at the given precision. */
function dateToFlexibleInput(date: Date, precision: DatePrecision): FlexibleDateInput {
  return {
    year: date.getUTCFullYear(),
    month: precision !== "year" ? date.getUTCMonth() + 1 : undefined,
    day: precision === "day" ? date.getUTCDate() : undefined,
    precision,
  };
}

/**
 * Convert a Date (from DB) to FlexibleDateInput (for form).
 * Falls back to "day" precision for legacy records without a precision column.
 */
export function dbToFlexibleDate(
  date: Date | null | undefined,
  savedPrecision: DatePrecision | null | undefined,
): FlexibleDateInput | null {
  if (!date) return null;

  // Use precision from DB, falling back to "day" for legacy records
  return dateToFlexibleInput(date, savedPrecision ?? "day");
}

/**
 * Convert FlexibleDateInput back to a Date for DB storage.
 * Partial dates normalize to: year -> Jan 1st, month -> 1st of month.
 */
export function flexibleDateToDb(input: FlexibleDateInput | null | undefined): Date | null {
  if (!input) return null;

  const { year, month = 1, day = 1 } = input;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Format a flexible date for display with localization. */
export function formatFlexibleDate(input: FlexibleDateInput | null | undefined): string {
  if (!input) return "";

  const { year, month, day, precision } = input;
  const userLocale = navigator.language;

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
