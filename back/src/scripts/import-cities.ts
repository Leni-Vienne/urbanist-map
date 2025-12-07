import { CitiesImportService } from "../services/cities-import.service";

/**
 * AI : Simple script to import cities and countries from worldcities.csv
 */
async function importData() {
  try {
    // AI : Import countries first
    await CitiesImportService.importCountries();

    // AI : Import cities
    await CitiesImportService.importCities();

    // AI : Show final statistics
    await CitiesImportService.getImportStats();
  } catch (error) {
    console.error("Import failed:", error);
    process.exit(1);
  }
}

void importData();
