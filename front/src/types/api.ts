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

export type PublishOverlayInput = RouterInput['overlay']['publishOverlay'];
export type PublishOverlayResponse = RouterOutput['overlay']['publishOverlay'];

// AI : City API types
export type GetCitiesNearLocationQuery = RouterInput['cities']['getCitiesNearLocation'];
export type GetCitiesNearLocationResponse = RouterOutput['cities']['getCitiesNearLocation'];
export type NearbyCity = GetCitiesNearLocationResponse[0];

export type GetCityProjectsQuery = RouterInput['cities']['getCityProjects'];
export type GetCityProjectsResponse = RouterOutput['cities']['getCityProjects'];
export type CityProject = GetCityProjectsResponse[0];

// AI : Country API types
export type GetCountriesWithProjectsResponse = RouterOutput['country']['getCountriesWithProjects'];
export type BackendCountry = GetCountriesWithProjectsResponse[0];

// AI : Moderation API types
export type GetPendingSubmissionsResponse = RouterOutput['moderation']['getPendingSubmissions'];
export type PendingProject = GetPendingSubmissionsResponse['projects'][0];
export type PendingOverlay = GetPendingSubmissionsResponse['overlays'][0];

export type SetProjectApprovalStatusInput = RouterInput['moderation']['setProjectApprovalStatus'];
export type SetProjectApprovalStatusResponse = RouterOutput['moderation']['setProjectApprovalStatus'];

export type SetOverlayApprovalStatusInput = RouterInput['moderation']['setOverlayApprovalStatus'];
export type SetOverlayApprovalStatusResponse = RouterOutput['moderation']['setOverlayApprovalStatus'];
