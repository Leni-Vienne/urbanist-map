import type { TimelineStatus } from "../../../back/src/db/schema";
import type { ProjectFormData } from "@/types/index";

function toDateObject(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) return value;
  // A nullish or empty input parses to an Invalid Date, which the NaN check below rejects.
  const date = new Date(value ?? "");
  return Number.isNaN(date.getTime()) ? null : date;
}

export function projectToFormData(p: {
  name?: string | null;
  description?: string | null;
  proposalDate?: Date | string | null;
  proposalDatePrecision?: "year" | "month" | "day" | null;
  startDate?: Date | string | null;
  startDatePrecision?: "year" | "month" | "day" | null;
  endDate?: Date | string | null;
  endDatePrecision?: "year" | "month" | "day" | null;
  sourceUrl?: string | null;
  tags?: string[] | null;
  timelineStatus?: TimelineStatus | null;
}): ProjectFormData {
  return {
    name: p.name ?? "",
    description: p.description || null,
    proposalDate: toDateObject(p.proposalDate),
    proposalDatePrecision: p.proposalDatePrecision ?? null,
    startDate: toDateObject(p.startDate),
    startDatePrecision: p.startDatePrecision ?? null,
    endDate: toDateObject(p.endDate),
    endDatePrecision: p.endDatePrecision ?? null,
    sourceUrl: p.sourceUrl || null,
    tags: p.tags ?? [],
    timelineStatus: p.timelineStatus ?? "proposed",
  };
}

export function projectFormFieldsDiffer(
  original: ProjectFormData[keyof ProjectFormData],
  current: ProjectFormData[keyof ProjectFormData],
): boolean {
  if (original instanceof Date && current instanceof Date) {
    return original.getTime() !== current.getTime();
  }

  const isOriginalEmpty = original === null || original === "";
  const isCurrentEmpty = current === null || current === "";
  if (
    (original instanceof Date && isCurrentEmpty) ||
    (isOriginalEmpty && current instanceof Date)
  ) {
    return true;
  }

  return original !== current;
}
