import { afterAll, describe, expect, setSystemTime, test } from "bun:test";

import { formatRelativeTime } from "./dateFormat";

function translate(key: string, args?: Record<string, string | number>): string {
  return `${key}:${args?.count ?? ""}`;
}

describe("formatRelativeTime", testFormatRelativeTime);

function testFormatRelativeTime(): void {
  afterAll(resetSystemTime);
  test("keeps intervals below 30 days in weeks", testJustBelowOneMonth);
  test("switches to months at 30 days", testOneMonth);
  test("keeps intervals below one year in months", testJustBelowOneYear);
  test("switches to years at one year", testOneYear);
}

function resetSystemTime(): void {
  setSystemTime();
}

function testJustBelowOneMonth(): void {
  setSystemTime(new Date("2026-08-24T07:44:00.000Z"));

  expect(formatRelativeTime("2026-07-25T07:45:11.552Z", translate)).toBe("relativeTime.weeksAgo:4");
}

function testOneMonth(): void {
  setSystemTime(new Date("2026-08-24T07:45:11.552Z"));

  expect(formatRelativeTime("2026-07-25T07:45:11.552Z", translate)).toBe("relativeTime.monthAgo:1");
}

function testJustBelowOneYear(): void {
  setSystemTime(new Date("2026-08-24T07:45:11.552Z"));

  expect(formatRelativeTime("2025-08-25T07:45:11.552Z", translate)).toBe(
    "relativeTime.monthsAgo:12",
  );
}

function testOneYear(): void {
  setSystemTime(new Date("2026-08-24T07:45:11.552Z"));

  expect(formatRelativeTime("2025-08-24T07:45:11.552Z", translate)).toBe("relativeTime.yearAgo:1");
}
