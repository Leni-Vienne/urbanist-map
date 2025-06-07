import { publicProcedure, router } from '../trpc';
import { CountriesService } from '../services/countries.service';

export const countriesRouter = router({
  // AI : Get countries with projects - most optimized query for homepage loading
  getCountriesWithProjects: publicProcedure
    .query(async () => {
      return await CountriesService.getCountriesWithProjects();
    }),

  // AI : Raw SQL version for maximum performance if needed
  getCountriesWithProjectsRaw: publicProcedure
    .query(async () => {
      return await CountriesService.getCountriesWithProjectsRaw();
    }),

  // AI : Fallback method without countries table (for backward compatibility)
  getCountriesFromCities: publicProcedure
    .query(async () => {
      return await CountriesService.getCountriesWithProjectsFromCities();
    }),
});
