// AI : Re-export only the schema types that the frontend needs
// AI : This prevents the frontend from importing the entire schema with all its dependencies

export type {
  DBCity,
  DBProject,
  DBCountry,
} from '../db/schema';
