/**
 * AI : Simple date formatting utility for consistent dd/mm/yyyy display across the app
 * No localization needed - uses plain numeric format
 */

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
