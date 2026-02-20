import type { FlexibleDateInput, DatePrecision } from "@shared/types/flexibleDate";
import { dateToFlexibleInput } from "@shared/validation/flexibleDateSchema";

/**
 * AI : Convert a standard Date object (from DB) to FlexibleDateInput (for form)
 * AI : Infers precision based on the date values (e.g. Jan 1st might be year precision)
 * AI : Note: Without explicit precision storage in DB yet, this is a best-guess or default
 */
export function dbToFlexibleDate(
  date: Date | null | undefined,
  savedPrecision: DatePrecision | null = null, // AI : Will be used when DB supports it
): FlexibleDateInput | null {
  if (!date) return null;

  // AI : If we have explicit precision from DB, use it
  if (savedPrecision) {
    return dateToFlexibleInput(date, savedPrecision);
  }

  // AI : For now, default to day precision as that's what we have
  // AI : In the future, we could try to infer: if (month===0 && day===1) -> year?
  // AI : But that's risky for actual Jan 1st dates. Better to stick to 'day' until DB migration.
  return dateToFlexibleInput(date, "day");
}

/**
 * AI : Convert FlexibleDateInput back to a standard Date for DB storage
 * AI : This normalizes partial dates to a specific point in time
 * AI : Year -> Jan 1st
 * AI : Month -> 1st of month
 */
export function flexibleDateToDb(input: FlexibleDateInput | null | undefined): Date | null {
  if (!input) return null;

  const { year, month = 1, day = 1 } = input;
  return new Date(year, month - 1, day);
}

/**
 * AI : Format a flexible date for display with localization
 */
export function formatFlexibleDate(
  input: FlexibleDateInput | null | undefined,
  locale?: string, // AI : Optional locale override, otherwise uses navigator.language
): string {
  if (!input) return "";

  const { year, month, day, precision } = input;
  const userLocale = locale ?? navigator.language;

  // AI : Create a date object for formatting
  // AI : Use noon to avoid timezone rollover issues with basic dates
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
