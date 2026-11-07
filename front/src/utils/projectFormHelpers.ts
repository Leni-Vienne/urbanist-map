import type { TimelineStatus } from "@shared/types/project";
import type { ProjectFormData } from "@/types/index";
import type { DatePrecision } from "@shared/types/flexibleDate";
import { projectValuesEqual } from "@/utils/projectValues";

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
  proposalDatePrecision?: DatePrecision | null;
  startDate?: Date | string | null;
  startDatePrecision?: DatePrecision | null;
  endDate?: Date | string | null;
  endDatePrecision?: DatePrecision | null;
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
  return !projectValuesEqual(
    Array.isArray(original) && Array.isArray(current) ? "tags" : "",
    original,
    current,
  );
}
