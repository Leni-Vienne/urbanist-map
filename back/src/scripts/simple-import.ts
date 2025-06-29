import { CitiesImportService } from '../services/cities-import.service';

/**
 * AI : Simple script to import cities and countries from worldcities.csv
 */
async function importData() {
  try {
    
    // AI : Import countries first
    const countryStats = await CitiesImportService.importCountries();
    
    // AI : Import cities
    const cityStats = await CitiesImportService.importCities();
    
    // AI : Show final statistics
    const stats = await CitiesImportService.getImportStats();
    
  } catch (error) {
    console.error('AI : Import failed:', error);
    process.exit(1);
  }
}

importData();
