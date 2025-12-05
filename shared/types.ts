// AI : Shared types used by both frontend and backend
import type { DBProject, DBCity, ApprovalStatus } from '../back/src/db/schema';
export type { ApprovalStatus } from '../back/src/db/schema';

export interface OverlayData {
    id: string;
    version: number;
    filename: string;
    caption: string | null;
    status: ApprovalStatus;
    projectId: string | null;
    authorId: string | null;
    replacesOverlayId: string | null;
    replacedByOverlayId: string | null;
    createdAt: Date;
    updatedAt: Date;
    centroid: {
        lat: number;
        lng: number;
    };
    corners: { lat: number; lng: number }[];
    suggestedCorners?: { lat: number; lng: number }[];
    project?: (Omit<DBProject, 'status'> & { status: ApprovalStatus | null; city: DBCity; }) | null;
    distance?: number;
    isModified?: boolean;
    hasPendingChanges?: boolean;
    pendingChangeRequestsCount?: number;
}

export interface FieldChange {
  fieldName: string;
  oldValue?: any;
  newValue: any;
  changeReason?: string;
}

export interface SubmitChangeRequestInput {
  entityType: 'project' | 'overlay';
  entityId: string;
  changes: FieldChange[];
}
