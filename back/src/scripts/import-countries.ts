import { CountriesImportService } from '../services/countries-import.service';

/**
 * AI : Script to import countries from countries.csv with upsert functionality
 * If countries already exist in database, updates their coordinates
 * If countries don't exist, inserts new records
 */
async function importCountriesData() {
  try {
    console.log('AI : Starting countries import process...');
    
    // AI : Show initial statistics
    console.log('AI : Getting initial database statistics...');
    await CountriesImportService.getCountriesStats();
    
    // AI : Import/update countries
    console.log('AI : Importing countries from CSV...');
    const result = await CountriesImportService.importCountries();
    
    console.log(`AI : Import completed successfully!`);
    console.log(`AI : - Countries inserted: ${result.inserted}`);
    console.log(`AI : - Countries updated: ${result.updated}`);
    console.log(`AI : - Errors: ${result.errors}`);
    
    // AI : Show final statistics
    console.log('AI : Getting final database statistics...');
    await CountriesImportService.getCountriesStats();
    
  } catch (error) {
    console.error('AI : Countries import failed:', error);
    process.exit(1);
  }
}

void importCountriesData();
