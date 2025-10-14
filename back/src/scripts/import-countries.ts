import { CountriesImportService } from '../services/countries-import.service';

/**
 * AI : Script to import countries from countries.csv with upsert functionality
 * If countries already exist in database, updates their coordinates
 * If countries don't exist, inserts new records
 */
async function importCountriesData() {
  try {
    console.log('Starting countries import process...');
    
    // AI : Show initial statistics
    console.log('Getting initial database statistics...');
    await CountriesImportService.getCountriesStats();
    
    // AI : Import/update countries
    console.log('Importing countries from CSV...');
    const result = await CountriesImportService.importCountries();
    
    console.log(`Import completed successfully!`);
    console.log(`- Countries inserted: ${result.inserted}`);
    console.log(`- Countries updated: ${result.updated}`);
    console.log(`- Errors: ${result.errors}`);
    
    // AI : Show final statistics
    console.log('Getting final database statistics...');
    await CountriesImportService.getCountriesStats();
    
  } catch (error) {
    console.error('Countries import failed:', error);
    process.exit(1);
  }
}

void importCountriesData();
