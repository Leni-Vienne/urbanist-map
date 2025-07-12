import { readFileSync } from 'fs';
import { join } from 'path';
import { db } from '../db';
import { cities, countries } from '../db/schema';
import { sql } from 'drizzle-orm';

interface CSVCity {
  city: string;
  city_ascii: string;
  lat: number;
  lng: number;
  country: string;
  iso2: string;
  iso3: string;
  admin_name: string;
  capital: string;
  population: number;
  id: string;
}

export class CitiesImportService {
  /**
   * AI : Parse a CSV line handling quoted values
   */
  private static parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current.trim());
    return result;
  }

  /**
   * AI : Load cities data from CSV file
   */  private static loadCitiesFromCSV(): CSVCity[] {
    try {
      // AI : Read CSV file from project root (one directory up from back folder)
      const csvPath = join(__dirname, '..', '..', '..', 'worldcities.csv');
      const csvContent = readFileSync(csvPath, 'utf-8');
      
      // AI : Parse CSV manually
      const lines = csvContent.split('\n');
      const headers = this.parseCSVLine(lines[0]);
      
      const cities: CSVCity[] = [];
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line) {
          const values = this.parseCSVLine(line);
          if (values.length >= headers.length) {
            const city: CSVCity = {
              city: values[0],
              city_ascii: values[1],
              lat: parseFloat(values[2]),
              lng: parseFloat(values[3]),
              country: values[4],
              iso2: values[5],
              iso3: values[6],
              admin_name: values[7],
              capital: values[8],
              population: parseInt(values[9]) ?? 0,
              id: values[10],
            };
            
            // AI : Only add cities with valid coordinates
            if (!isNaN(city.lat) && !isNaN(city.lng)) {
              cities.push(city);
            }
          }
        }
      }
      
      return cities;
    } catch (error) {
      console.error('AI : Error loading cities data:', error);
      return [];
    }
  }

  /**
   * AI : Import cities from CSV to database using simplified schema
   */
  static async importCities(): Promise<{ imported: number; skipped: number; errors: number }> {
    
    try {
      // AI : Load cities from CSV
      const csvCities = this.loadCitiesFromCSV();
      
      if (csvCities.length === 0) {
        throw new Error('No cities loaded from CSV');
      }

      // AI : Clear existing cities
      await db.delete(cities);

      let imported = 0;
      let skipped = 0;
      let errors = 0;
      const batchSize = 100;

      // AI : Process cities in batches for better performance
      for (let i = 0; i < csvCities.length; i += batchSize) {
        const batch = csvCities.slice(i, i + batchSize);
        const insertData = [];

        for (const city of batch) {
          try {
            // AI : Map CSV data to simplified schema (only fields that exist in your schema)
            insertData.push({
              name: city.city,
              countryCode: city.iso3, // AI : Using ISO3 code as country code
              coordinates: sql`ST_SetSRID(ST_MakePoint(${city.lng}, ${city.lat}), 4326)`,
            });
          } catch (error) {
            console.error(`AI : Error preparing city ${city.city}:`, error);
            errors++;
          }
        }

        if (insertData.length > 0) {
          try {
            await db.insert(cities).values(insertData);
            imported += insertData.length;
          } catch (error) {
            console.error(`AI : Error inserting batch:`, error);
            errors += insertData.length;
          }
        }
      }

      
      return { imported, skipped, errors };
    } catch (error) {
      console.error('AI : Error importing cities:', error);
      throw error;
    }
  }

  /**
   * AI : Import unique countries from CSV to database
   */
  static async importCountries(): Promise<{ imported: number; skipped: number; errors: number }> {
    
    try {
      // AI : Load cities from CSV to extract unique countries
      const csvCities = this.loadCitiesFromCSV();
      
      if (csvCities.length === 0) {
        throw new Error('No cities loaded from CSV');
      }

      // AI : Extract unique countries with their coordinates (using capital city or first city)
      const countryMap = new Map<string, { name: string; lat: number; lng: number }>();
      
      for (const city of csvCities) {
        const key = city.iso3;
        if (!countryMap.has(key) ?? city.capital === 'primary') {
          // AI : Prefer primary capital for country center, otherwise use first city found
          countryMap.set(key, {
            name: city.country,
            lat: city.lat,
            lng: city.lng
          });
        }
      }

      // AI : Clear existing countries
      await db.delete(countries);

      let imported = 0;
      let errors = 0;      // AI : Insert countries
      const insertData = [];
      for (const [code, data] of Array.from(countryMap.entries())) {
        try {
          insertData.push({
            code: code,
            name: data.name,
            centerCoordinates: sql`ST_SetSRID(ST_MakePoint(${data.lng}, ${data.lat}), 4326)`,
          });
        } catch (error) {
          console.error(`AI : Error preparing country ${data.name}:`, error);
          errors++;
        }
      }

      if (insertData.length > 0) {
        try {
          await db.insert(countries).values(insertData);
          imported = insertData.length;
        } catch (error) {
          console.error(`AI : Error inserting countries:`, error);
          errors = insertData.length;
        }
      }

      
      return { imported, skipped: 0, errors };
    } catch (error) {
      console.error('AI : Error importing countries:', error);
      throw error;
    }
  }

  /**
   * AI : Get import statistics
   */
  static async getImportStats(): Promise<{ totalCities: number; totalCountries: number }> {
    try {
      const totalCitiesResult = await db.select({ count: sql`count(*)` }).from(cities);
      const totalCities = Number(totalCitiesResult[0]?.count ?? 0);

      const totalCountriesResult = await db.select({ count: sql`count(*)` }).from(countries);
      const totalCountries = Number(totalCountriesResult[0]?.count ?? 0);

      return { totalCities, totalCountries };
    } catch (error) {
      console.error('AI : Error getting import stats:', error);
      throw error;
    }
  }
}
