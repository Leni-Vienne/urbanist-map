import type { Project, ProjectFormData } from "@/types/index";

function toDateObject(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Convert any project-shaped object to ProjectFormData.
 * Handles string→Date coercion and null→default normalization.
 * Single source of truth for Project→form mapping.
 */
export function projectToFormData(p: {
  name?: string | null;
  description?: string | null;
  proposalDate?: Date | string | null;
  proposalDatePrecision?: "year" | "month" | "day" | null;
  startDate?: Date | string | null;
  startDatePrecision?: "year" | "month" | "day" | null;
  endDate?: Date | string | null;
  endDatePrecision?: "year" | "month" | "day" | null;
  cityId?: number | null;
  countryCode?: string | null;
  sourceUrl?: string | null;
  tags?: string[] | null;
  timelineStatus?: string | null;
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
    cityId: p.cityId ?? null,
    countryCode: p.countryCode ?? "",
    sourceUrl: p.sourceUrl || null,
    tags: p.tags ?? [],
    timelineStatus:
      (p.timelineStatus as
        | "proposed"
        | "planned"
        | "under_construction"
        | "completed"
        | "canceled") ?? "proposed",
  };
}

/**
 * Convert ProjectFormData back to the editable subset of Project fields.
 * Single source of truth for form→Project mapping.
 */
export function formDataToProjectFields(f: ProjectFormData): Partial<Project> {
  return {
    name: f.name,
    description: f.description ?? null,
    proposalDate: f.proposalDate ?? null,
    proposalDatePrecision: f.proposalDatePrecision ?? null,
    startDate: f.startDate ?? null,
    startDatePrecision: f.startDatePrecision ?? null,
    endDate: f.endDate ?? null,
    endDatePrecision: f.endDatePrecision ?? null,
    cityId: f.cityId ?? undefined,
    countryCode: f.countryCode,
    sourceUrl: f.sourceUrl ?? null,
    tags: f.tags,
    timelineStatus: f.timelineStatus,
  };
}
