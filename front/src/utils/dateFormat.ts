/**
 * Simple date formatting utilities with no external dependencies.
 * For project date ranges with flexible precision, use projectDateFormat.ts instead.
 */

/** Format a date as dd/mm/yyyy. */
export function formatDate(date: Date | string | null | undefined): string {
  // A nullish or empty input parses to an Invalid Date, which the NaN check below rejects.
  const d = date instanceof Date ? date : new Date(date ?? "");
  if (Number.isNaN(d.getTime())) return "";

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  return `${day}/${month}/${year}`;
}

/** Format a date as relative time using i18n translations. */
export function formatRelativeTime(
  date: Date | string | null | undefined,
  t: (key: string, args?: Record<string, string | number>) => string,
): string {
  const now = new Date();
  const targetDate = date instanceof Date ? date : new Date(date ?? "");

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
