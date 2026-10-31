import { afterAll, describe, expect, setSystemTime, test } from "bun:test";

import { formatRelativeTime } from "./dateFormat";

function translate(key: string, args?: Record<string, string | number>): string {
  return `${key}:${args?.count ?? ""}`;
}

describe("formatRelativeTime", () => {
  afterAll(() => {
    setSystemTime();
  });

  test("keeps intervals below 30 days in weeks", () => {
    setSystemTime(new Date("2026-08-24T07:44:00.000Z"));

    expect(formatRelativeTime("2026-07-25T07:45:11.552Z", translate)).toBe(
      "relativeTime.weeksAgo:4",
    );
  });

  test("switches to months at 30 days", () => {
    setSystemTime(new Date("2026-08-24T07:45:11.552Z"));

    expect(formatRelativeTime("2026-07-25T07:45:11.552Z", translate)).toBe(
      "relativeTime.monthAgo:1",
    );
  });

  test("keeps intervals below one year in months", () => {
    setSystemTime(new Date("2026-08-24T07:45:11.552Z"));

    expect(formatRelativeTime("2025-08-25T07:45:11.552Z", translate)).toBe(
      "relativeTime.monthsAgo:12",
    );
  });

  test("switches to years at one year", () => {
    setSystemTime(new Date("2026-08-24T07:45:11.552Z"));

    expect(formatRelativeTime("2025-08-24T07:45:11.552Z", translate)).toBe(
      "relativeTime.yearAgo:1",
    );
  });
});
