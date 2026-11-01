import type { DatePrecision } from "./flexibleDate";

export interface SeoLocation {
  city: string | null;
  state: string | null;
  country: string | null;
  label: string | null; // "City, State, Country" with missing levels dropped
}

// JSON payload for a live project. Dates arrive as ISO strings, not Date instances.
export interface SeoProject {
  status: "ok";
  name: string | null;
  description: string | null;
  slug: string | null;
  timelineStatus: string;
  proposalDate: string | null;
  proposalDatePrecision: DatePrecision | null;
  startDate: string | null;
  startDatePrecision: DatePrecision | null;
  endDate: string | null;
  endDatePrecision: DatePrecision | null;
  tags: string[] | null;
  externalLastModified: string | null;
  lat: number | null;
  lng: number | null;
  indexable: boolean;
  bounds: [number, number, number, number] | null;
  location: SeoLocation;
  image: string | null;
  canonical: string;
}

export type SeoProjectResponse =
  | SeoProject
  | {
      status: "gone";
      slug: string;
      lat: number | null;
      lng: number | null;
      projectStatus: string;
    }
  | { status: "not_found"; slug: string }
  | { status: "error" };
