import { TRPCError } from "@trpc/server";
import type {
  OverlayFieldName,
  ProjectFieldName,
  SubmissionBatchInput,
} from "@shared/validation/schemas";
import type { ApprovalStatus } from "../db/schema";

type SubmittedProject = NonNullable<SubmissionBatchInput["project"]>;
type SubmittedOverlay = SubmissionBatchInput["overlays"][number];

type ExistingProjectValues = {
  [Field in ProjectFieldName]: SubmittedProject[Field] | null;
};

export type ExistingSubmissionProject = ExistingProjectValues & {
  id: string;
  status: ApprovalStatus;
  ownerId: string | null;
  lat: number | null;
  lng: number | null;
};

type ExistingOverlayValues = {
  [Field in OverlayFieldName]: SubmittedOverlay[Field] | null;
};

export type ExistingSubmissionOverlay = ExistingOverlayValues & {
  id: string;
  status: ApprovalStatus;
  authorId: string | null;
  filename: string;
  kind: "map" | "render";
  projectId: string | null;
  lat: number | null;
  lng: number | null;
};

export interface SubmissionPolicyState {
  existingProject?: ExistingSubmissionProject;
  existingOverlays: Map<string, ExistingSubmissionOverlay>;
}

interface ClassifiedChange {
  fieldName: ProjectFieldName | OverlayFieldName;
  oldValue: unknown;
  newValue: unknown;
  changeReason?: string;
}

export interface ClassifiedChangeRequest {
  entityType: "project" | "overlay";
  entityId: string;
  changes: ClassifiedChange[];
  lat: number | null;
  lng: number | null;
}

export interface SubmissionPlan {
  project?: SubmittedProject;
  overlays: SubmittedOverlay[];
  changeRequests: ClassifiedChangeRequest[];
}

function requireChangedFields(fields: readonly unknown[], entityName: string): void {
  if (fields.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `No changes supplied for ${entityName}` });
  }
}

function valuesDiffer(oldValue: unknown, newValue: unknown): boolean {
  return JSON.stringify(oldValue) !== JSON.stringify(newValue);
}

function submittedProjectValue(project: SubmittedProject, field: ProjectFieldName): unknown {
  if (field === "tags") return project.tags ?? [];
  if (field === "name" || field === "timelineStatus") return project[field];
  return project[field] ?? null;
}

function buildProjectChangeRequest(
  project: SubmittedProject,
  existing: ExistingSubmissionProject,
  reason: string | undefined,
): ClassifiedChangeRequest {
  requireChangedFields(project.changedFields, "approved project");
  const changes: ClassifiedChange[] = [];
  for (const fieldName of project.changedFields) {
    const oldValue = fieldName === "tags" ? (existing.tags ?? []) : existing[fieldName];
    const newValue = submittedProjectValue(project, fieldName);
    if (valuesDiffer(oldValue, newValue)) {
      changes.push({ fieldName, oldValue, newValue, changeReason: reason });
    }
  }
  requireChangedFields(changes, "approved project");
  return {
    entityType: "project",
    entityId: project.id,
    changes,
    lat: existing.lat,
    lng: existing.lng,
  };
}

function buildOverlayChangeRequest(
  overlay: SubmittedOverlay,
  existing: ExistingSubmissionOverlay,
  reason: string | undefined,
): ClassifiedChangeRequest {
  requireChangedFields(overlay.changedFields, "approved overlay");
  const changes: ClassifiedChange[] = [];
  for (const fieldName of overlay.changedFields) {
    const oldValue = fieldName === "caption" ? existing.caption : existing.corners;
    const newValue = fieldName === "caption" ? (overlay.caption ?? null) : overlay.corners;
    if (valuesDiffer(oldValue, newValue)) {
      changes.push({ fieldName, oldValue, newValue, changeReason: reason });
    }
  }
  requireChangedFields(changes, "approved overlay");
  return {
    entityType: "overlay",
    entityId: overlay.id,
    changes,
    lat: existing.lat,
    lng: existing.lng,
  };
}

export function classifySubmission(
  input: SubmissionBatchInput,
  state: SubmissionPolicyState,
): SubmissionPlan {
  if (!state.existingProject && !input.project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }

  const plan: SubmissionPlan = { overlays: [], changeRequests: [] };
  if (input.project) {
    if (state.existingProject?.status === "approved") {
      plan.changeRequests.push(
        buildProjectChangeRequest(input.project, state.existingProject, input.reason),
      );
    } else {
      if (state.existingProject) requireChangedFields(input.project.changedFields, "project");
      plan.project = input.project;
    }
  }

  for (const overlay of input.overlays) {
    const existing = state.existingOverlays.get(overlay.id);
    if (existing && existing.projectId !== input.projectId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Overlay belongs to another project" });
    }
    if (existing?.status === "approved") {
      plan.changeRequests.push(buildOverlayChangeRequest(overlay, existing, input.reason));
    } else {
      if (existing) requireChangedFields(overlay.changedFields, "overlay");
      plan.overlays.push(overlay);
    }
  }
  return plan;
}
