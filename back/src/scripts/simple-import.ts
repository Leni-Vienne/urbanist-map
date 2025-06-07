import { CitiesImportService } from '../services/cities-import.service';

/**
 * AI : Simple script to import cities and countries from worldcities.csv
 */
async function importData() {
  try {
    console.log('AI : Starting data import from worldcities.csv...');
    
    // AI : Import countries first
    console.log('\n=== IMPORTING COUNTRIES ===');
    const countryStats = await CitiesImportService.importCountries();
    console.log(`Countries: ${countryStats.imported} imported, ${countryStats.errors} errors`);
    
    // AI : Import cities
    console.log('\n=== IMPORTING CITIES ===');
    const cityStats = await CitiesImportService.importCities();
    console.log(`Cities: ${cityStats.imported} imported, ${cityStats.skipped} skipped, ${cityStats.errors} errors`);
    
    // AI : Show final statistics
    console.log('\n=== IMPORT SUMMARY ===');
    const stats = await CitiesImportService.getImportStats();
    console.log(`Total cities in database: ${stats.totalCities}`);
    console.log(`Total countries in database: ${stats.totalCountries}`);
    
    console.log('\nAI : Import completed successfully!');
  } catch (error) {
    console.error('AI : Import failed:', error);
    process.exit(1);
  }
}

importData();
