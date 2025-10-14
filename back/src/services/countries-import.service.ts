import { readFileSync } from 'fs';
import { join } from 'path';
import { db } from '../database';
import { countries } from '../db/schema';
import { sql, eq } from 'drizzle-orm';
import { parseCSVLine } from '../utils/csv-parser';

interface CSVCountry {
  country: string;
  alpha2Code: string;
  alpha3Code: string;
  numericCode: string;
  latitude: number;
  longitude: number;
}

export class CountriesImportService {
  /**
   * AI : Load countries data from CSV file
   */
  private static loadCountriesFromCSV(): CSVCountry[] {
    try {
      // AI : Read CSV file from project root
      const csvPath = join(__dirname, '..', '..', '..', 'countries.csv');
      
      const csvData = readFileSync(csvPath, 'utf-8');
      const lines = csvData.split('\n').filter(line => line.trim());
      
      if (lines.length === 0) {
        throw new Error('Empty CSV file');
      }

      // AI : Skip header line
      const dataLines = lines.slice(1);
      const countries: CSVCountry[] = [];

      for (let i = 0; i < dataLines.length; i++) {
        const line = dataLines[i].trim();
        if (!line) continue;

        try {
          const fields = parseCSVLine(line);
          
          if (fields.length >= 6) {
            const country: CSVCountry = {
              country: fields[0].replace(/"/g, ''),
              alpha2Code: fields[1],
              alpha3Code: fields[2],
              numericCode: fields[3],
              latitude: parseFloat(fields[4]),
              longitude: parseFloat(fields[5])
            };

            // AI : Validate required fields
            if (country.alpha3Code && country.country && !isNaN(country.latitude) && !isNaN(country.longitude)) {
              countries.push(country);
            } else {
              console.warn(`Skipping invalid country at line ${i + 2}: ${line}`);
            }
          }
        } catch (error) {
          console.error(`Error parsing line ${i + 2}: ${line}`, error);
        }
      }
      return countries;
    } catch (error) {
      console.error('Error loading countries CSV:', error);
      throw error;
    }
  }

  /**
   * AI : Import countries from CSV with upsert functionality
   * If country exists, update coordinates; if not, insert new record
   */
  static async importCountries(): Promise<{ inserted: number; updated: number; errors: number }> {
    try {
      const csvCountries = this.loadCountriesFromCSV();
      
      if (csvCountries.length === 0) {
        throw new Error('No countries loaded from CSV');
      }

      let inserted = 0;
      let updated = 0;
      let errors = 0;

      // AI : Process each country individually for upsert logic
      for (const csvCountry of csvCountries) {
        try {
          // AI : Check if country already exists
          const existingCountry = await db
            .select()
            .from(countries)
            .where(eq(countries.code, csvCountry.alpha3Code))
            .limit(1);

          const countryData = {
            code: csvCountry.alpha3Code,
            name: csvCountry.country,
            centerCoordinates: sql`ST_SetSRID(ST_MakePoint(${csvCountry.longitude}, ${csvCountry.latitude}), 4326)`
          };

          if (existingCountry.length > 0) {
            // AI : Update existing country coordinates
            await db
              .update(countries)
              .set({
                centerCoordinates: sql`ST_SetSRID(ST_MakePoint(${csvCountry.longitude}, ${csvCountry.latitude}), 4326)`,
                updatedAt: sql`NOW()`
              })
              .where(eq(countries.code, csvCountry.alpha3Code));
            
            updated++;
          } else {
            // AI : Insert new country
            await db.insert(countries).values(countryData);
            inserted++;
          }

        } catch (error) {
          console.error(`Error processing country ${csvCountry.country}:`, error);
          errors++;
        }
      }

      return { inserted, updated, errors };
    } catch (error) {
      console.error('Error importing countries:', error);
      throw error;
    }
  }

  /**
   * AI : Get countries statistics
   */
  static async getCountriesStats(): Promise<{ totalCountries: number }> {
    try {
      const totalCountriesResult = await db.select({ count: sql`count(*)` }).from(countries);
      const totalCountries = Number(totalCountriesResult[0]?.count ?? 0);

      return { totalCountries };
    } catch (error) {
      console.error('Error getting countries stats:', error);
      throw error;
    }
  }
}
