// AI : Centralized tRPC types for consistent type safety across the application
import type { RouterInput, RouterOutput } from '@client';

// AI : Project API types
export type ProjectsNearLocationQuery = RouterInput['project']['getProjectsNearLocation'];
export type ProjectsNearLocationResponse = RouterOutput['project']['getProjectsNearLocation'];
export type NearbyProject = ProjectsNearLocationResponse['projects'][0];

export type PublishProjectInput = RouterInput['project']['publishProject'];
export type PublishProjectResponse = RouterOutput['project']['publishProject'];

// AI : Overlay API types
export type GetOverlayQuery = RouterInput['overlay']['getOverlay'];
export type GetOverlayResponse = RouterOutput['overlay']['getOverlay'];
export type BackendOverlay = NonNullable<GetOverlayResponse['overlay']>;
export type IntersectingOverlay = GetOverlayResponse['intersectingOverlays'][0];

export type LatestOverlay = RouterOutput['overlay']['getLatestOverlays'][number];

export type PublishOverlayInput = RouterInput['overlay']['publishOverlay'];
export type PublishOverlayResponse = RouterOutput['overlay']['publishOverlay'];

// AI : City API types
export type GetCitiesNearLocationQuery = RouterInput['cities']['getCitiesNearLocation'];
export type GetCitiesNearLocationResponse = RouterOutput['cities']['getCitiesNearLocation'];
export type NearbyCity = GetCitiesNearLocationResponse[0];

export type GetCityProjectsQuery = RouterInput['cities']['getCityProjects'];
export type GetCityProjectsResponse = RouterOutput['cities']['getCityProjects'];
// AI : getCityProjects now returns OverlayData array directly - use OverlayData from types.ts

// AI : Country API types
export type GetCountriesWithProjectsResponse = RouterOutput['country']['getCountriesWithProjects'];
export type BackendCountry = GetCountriesWithProjectsResponse[0];

// AI : Moderation API types
export type GetPendingSubmissionsResponse = RouterOutput['moderation']['getPendingSubmissions'];
export type PendingProject = GetPendingSubmissionsResponse['projects'][0];
export type PendingOverlay = GetPendingSubmissionsResponse['overlays'][0];
export type PendingChangeRequest = GetPendingSubmissionsResponse['changeRequests'][0];

export type UndoProjectApprovalStatusInput = RouterInput['moderation']['undoProjectApprovalStatus'];
export type UndoProjectApprovalStatusResponse = RouterOutput['moderation']['undoProjectApprovalStatus'];

export type UndoOverlayApprovalStatusInput = RouterInput['moderation']['undoOverlayApprovalStatus'];
export type UndoOverlayApprovalStatusResponse = RouterOutput['moderation']['undoOverlayApprovalStatus'];

// AI : Change tracking API types
export type SubmitChangeRequestInput = RouterInput['changes']['submitChangeRequest'];
export type SubmitChangeRequestResponse = RouterOutput['changes']['submitChangeRequest'];

export type GetPendingChangeRequestsResponse = RouterOutput['changes']['getPendingChangeRequests'];
export type ChangeRequest = GetPendingChangeRequestsResponse[0];

export type ApproveChangeRequestsInput = RouterInput['changes']['approveChangeRequests'];
export type ApproveChangeRequestsResponse = RouterOutput['changes']['approveChangeRequests'];

export type RejectChangeRequestsInput = RouterInput['changes']['rejectChangeRequests'];
export type RejectChangeRequestsResponse = RouterOutput['changes']['rejectChangeRequests'];

export type GetChangeHistoryInput = RouterInput['changes']['getChangeHistory'];
export type GetChangeHistoryResponse = RouterOutput['changes']['getChangeHistory'];
export type ChangeHistoryEntry = GetChangeHistoryResponse[0];
