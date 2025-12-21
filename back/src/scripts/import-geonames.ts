import { db } from "../database";
import { countries, cities } from "../db/schema";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as readline from "readline";
import * as path from "path";

/**
 * AI : Import countries and cities from GeoNames data with local name support
 *
 * Required files:
 * - countries.csv: Country coordinates (included in project)
 * - countryInfo.txt: Country languages and details
 * - cities15000.txt: Cities with population > 15000
 * - alternateNamesV2.csv: Local/native city names (optional but recommended)
 *
 * Download GeoNames files from: https://download.geonames.org/export/dump/
 *
 * Usage:
 * - Place GeoNames files in ./geonames-data/ directory
 * - Run: bun run back/src/scripts/import-geonames.ts
 */

const GEONAMES_DIR = path.join(process.cwd(), "geonames-data");
const COUNTRIES_CSV = path.join(process.cwd(), "countries.csv");
const BATCH_SIZE = 1000; // Insert in batches for better performance

interface CountryData {
  id: number;
  code: string; // ISO 3166-1 alpha-3
  code2: string; // ISO 3166-1 alpha-2
  name: string;
  latitude: number;
  longitude: number;
}

interface CityData {
  id: number;
  name: string;
  nameLocal: string | null;
  countryCode: string; // ISO 3166-1 alpha-3
  latitude: number;
  longitude: number;
}

// AI : Mapping from ISO alpha-2 to alpha-3
const alpha2ToAlpha3Map = new Map<string, string>();
// AI : Country to main language mapping (for local names)
const countryLanguageMap = new Map<string, string>();
// AI : City ID to country code mapping (for local name filtering)
const cityCountryMap = new Map<number, string>();
// AI : Country coordinates from CSV
const countryCoordinates = new Map<string, { lat: number; lng: number }>();

/**
 * AI : Load country coordinates from countries.csv
 */
async function loadCountryCoordinates(): Promise<void> {
  console.log("📍 Loading country coordinates from countries.csv...");

  if (!fs.existsSync(COUNTRIES_CSV)) {
    throw new Error(`countries.csv not found at: ${COUNTRIES_CSV}`);
  }

  const fileStream = fs.createReadStream(COUNTRIES_CSV);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber++;

    // AI : Skip header line
    if (lineNumber === 1) continue;

    // AI : Parse CSV with proper handling of quoted fields
    // AI : Country names can contain commas (e.g., "Korea, Republic of")
    const fields = parseCSVLine(line);
    if (fields.length >= 6) {
      const _alpha2 = fields[1]; // Alpha-2 code
      const alpha3 = fields[2]; // Alpha-3 code
      const lat = parseFloat(fields[4]);
      const lng = parseFloat(fields[5]);

      if (alpha3 && !isNaN(lat) && !isNaN(lng)) {
        countryCoordinates.set(alpha3, { lat, lng });
      }
    }
  }

  console.log(`  ✓ Loaded coordinates for ${countryCoordinates.size} countries`);
}

/**
 * AI : Parse a CSV line handling quoted fields properly
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      fields.push(currentField);
      currentField = "";
    } else {
      currentField += char;
    }
  }

  // AI : Push the last field
  fields.push(currentField);

  return fields;
}

/**
 * AI : Load country language mappings from countryInfo.txt
 * AI : This is needed to identify the main language for each country
 */
async function loadCountryLanguages(): Promise<void> {
  console.log("🗣️  Loading country languages from countryInfo.txt...");
  const filePath = path.join(GEONAMES_DIR, "countryInfo.txt");

  if (!fs.existsSync(filePath)) {
    console.warn("⚠️  countryInfo.txt not found - local names will not be extracted");
    return;
  }

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    // AI : Skip comments
    if (line.startsWith("#") || line.trim() === "") continue;

    const fields = line.split("\t");
    if (fields.length > 15) {
      const iso2 = fields[0].trim();
      const iso3 = fields[1].trim();
      // AI : Languages field contains comma-separated codes, take the first one
      const rawLang = fields[15].split(",")[0].split("-")[0].trim();

      if (iso2 && iso3 && rawLang) {
        alpha2ToAlpha3Map.set(iso2, iso3);
        countryLanguageMap.set(iso2, rawLang);
      }
    }
  }

  // AI : Manual fixes for common discrepancies
  countryLanguageMap.set("CZ", "cs"); // Czech Republic

  console.log(`  ✓ Loaded languages for ${countryLanguageMap.size} countries`);
}

/**
 * AI : Parse countryInfo.txt and import countries with actual coordinates
 */
async function importCountries(): Promise<void> {
  console.log("\n📍 Importing countries from GeoNames...");
  const filePath = path.join(GEONAMES_DIR, "countryInfo.txt");

  if (!fs.existsSync(filePath)) {
    throw new Error(`Country file not found: ${filePath}`);
  }

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const countryBatch: CountryData[] = [];
  let importedCount = 0;

  for await (const line of rl) {
    // AI : Skip comments and empty lines
    if (line.startsWith("#") || line.trim() === "") continue;

    const fields = line.split("\t");
    if (fields.length < 17) continue;

    const [
      iso2, // 0: ISO alpha-2
      iso3, // 1: ISO alpha-3
      isoNumeric, // 2: ISO numeric
      fips, // 3: FIPS code
      countryName, // 4: Country name
      capital, // 5: Capital
      area, // 6: Area
      population, // 7: Population
      continent, // 8: Continent
      tld, // 9: TLD
      currencyCode, // 10: Currency
      currencyName, // 11: Currency name
      phone, // 12: Phone prefix
      postalCodeFormat, // 13: Postal code format
      postalCodeRegex, // 14: Postal code regex
      languages, // 15: Languages
      geonameId, // 16: GeoNames ID
    ] = fields;

    // AI : Skip entries without proper data
    if (!iso2 || !iso3 || !geonameId || !countryName) continue;

    // AI : Get coordinates from countries.csv
    const coords = countryCoordinates.get(iso3);
    if (!coords) {
      console.warn(`⚠️  No coordinates for ${countryName} (${iso3})`);
      continue;
    }

    countryBatch.push({
      id: parseInt(geonameId, 10),
      code: iso3,
      code2: iso2,
      name: countryName,
      latitude: coords.lat,
      longitude: coords.lng,
    });

    // AI : Insert in batches
    if (countryBatch.length >= BATCH_SIZE) {
      await insertCountryBatch(countryBatch);
      importedCount += countryBatch.length;
      console.log(`  ✓ Imported ${importedCount} countries...`);
      countryBatch.length = 0;
    }
  }

  // AI : Insert remaining countries
  if (countryBatch.length > 0) {
    await insertCountryBatch(countryBatch);
    importedCount += countryBatch.length;
  }

  console.log(`✅ Imported ${importedCount} countries total`);
}

/**
 * AI : Insert country batch into database
 */
async function insertCountryBatch(batch: CountryData[]): Promise<void> {
  const values = batch.map((country) => ({
    id: country.id,
    code: country.code,
    code2: country.code2,
    name: country.name,
    centerCoordinates: sql`ST_SetSRID(ST_MakePoint(${country.longitude}, ${country.latitude}), 4326)`,
  }));

  await db.insert(countries).values(values).onConflictDoNothing();
}

/**
 * AI : Parse cities15000.txt and import cities (without local names initially)
 */
async function importCities(): Promise<void> {
  console.log("\n🏙️  Importing cities from GeoNames...");
  const filePath = path.join(GEONAMES_DIR, "cities5000.txt");

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Cities file not found: ${filePath}\nDownload from: https://download.geonames.org/export/dump/cities15000.zip`,
    );
  }

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const cityBatch: CityData[] = [];
  let importedCount = 0;
  let skippedCount = 0;

  for await (const line of rl) {
    const fields = line.split("\t");
    if (fields.length < 9) continue;

    const [
      geonameId, // 0: GeoNames ID
      name, // 1: Name (ASCII)
      asciiname, // 2: ASCII name
      alternateNames, // 3: Alternate names
      latitude, // 4: Latitude
      longitude, // 5: Longitude
      featureClass, // 6: Feature class
      featureCode, // 7: Feature code
      countryCode2, // 8: Country code (ISO alpha-2)
    ] = fields;

    if (!geonameId || !name || !latitude || !longitude || !countryCode2) {
      skippedCount++;
      continue;
    }

    // AI : Convert country code from alpha-2 to alpha-3
    const countryCode3 = alpha2ToAlpha3Map.get(countryCode2);
    if (!countryCode3) {
      skippedCount++;
      continue;
    }

    const cityId = parseInt(geonameId, 10);

    // AI : Store mapping for local name processing
    cityCountryMap.set(cityId, countryCode2);

    cityBatch.push({
      id: cityId,
      name: name,
      nameLocal: null, // AI : Will be updated by updateCityLocalNames()
      countryCode: countryCode3,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
    });

    if (cityBatch.length >= BATCH_SIZE) {
      await insertCityBatch(cityBatch);
      importedCount += cityBatch.length;
      console.log(`  ✓ Imported ${importedCount} cities...`);
      cityBatch.length = 0;
    }
  }

  if (cityBatch.length > 0) {
    await insertCityBatch(cityBatch);
    importedCount += cityBatch.length;
  }

  console.log(`✅ Imported ${importedCount} cities total (skipped ${skippedCount})`);
}

/**
 * AI : Insert city batch into database
 */
async function insertCityBatch(batch: CityData[]): Promise<void> {
  const values = batch.map((city) => ({
    id: city.id,
    name: city.name,
    nameLocal: city.nameLocal,
    countryCode: city.countryCode,
    coordinates: sql`ST_SetSRID(ST_MakePoint(${city.longitude}, ${city.latitude}), 4326)`,
    approvedProjectCount: 0,
  }));

  await db.insert(cities).values(values).onConflictDoNothing();
}

/**
 * AI : Update city local names from alternateNamesV2.txt
 * AI : Logic inspired by alternateName.py - prioritizes native language names
 */
async function updateCityLocalNames(): Promise<void> {
  console.log("\n🌐 Processing local names from alternateNamesV2.txt...");
  const filePath = path.join(GEONAMES_DIR, "alternateNamesV2.txt");

  if (!fs.existsSync(filePath)) {
    console.warn("⚠️  alternateNamesV2.txt not found - skipping local names");
    console.log(
      "    Download from: https://download.geonames.org/export/dump/alternateNamesV2.zip",
    );
    return;
  }

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  // AI : Map to store best local name for each city
  const cityLocalNames = new Map<number, { name: string; priority: number }>();

  let processedCount = 0;
  for await (const line of rl) {
    const fields = line.split("\t");
    if (fields.length < 5) continue;

    const geonameId = parseInt(fields[1], 10);
    const lang = fields[2]; // Language code
    const alternateName = fields[3];
    const isPreferred = fields[4] === "1";

    // AI : Skip Wikipedia/Wikidata URLs and other non-name entries
    // AI : GeoNames uses specific language codes for these:
    // AI : - 'link': Wikipedia URLs
    // AI : - 'wkdt': Wikidata URLs
    // AI : - 'unlc': UN location codes
    if (lang === "link" || lang === "wkdt" || lang === "unlc") {
      continue;
    }

    // AI : Also skip if it looks like a URL (backup check)
    if (alternateName.startsWith("http://") || alternateName.startsWith("https://")) {
      continue;
    }

    // AI : Only process cities we imported
    const countryCode = cityCountryMap.get(geonameId);
    if (!countryCode) continue;

    const targetLang = countryLanguageMap.get(countryCode);

    // AI : Priority system (inspired by alternateName.py):
    // 1st: Native language (e.g., 'ja' for Japan, 'ru' for Russia)
    // 2nd: Unlabeled local names (empty string)
    // 3rd: Preferred names
    // Skip: English names (we already have ASCII names)

    let priority = 0;
    if (lang === targetLang) {
      priority = 100; // Highest priority: native language
    } else if (lang === "") {
      priority = 50; // Medium priority: unlabeled (often local)
    } else if (isPreferred) {
      priority = 25; // Lower priority: preferred but not native
    } else if (lang === "en") {
      continue; // Skip English - we already have ASCII names
    } else {
      priority = 10; // Lowest priority: other languages
    }

    // AI : Only update if this is better than what we have
    const existing = cityLocalNames.get(geonameId);
    if (!existing || priority > existing.priority) {
      cityLocalNames.set(geonameId, { name: alternateName, priority });
    }

    processedCount++;
    if (processedCount % 100000 === 0) {
      console.log(`  ⏳ Processed ${processedCount} name records...`);
    }
  }

  // AI : Update cities in database using batch SQL for performance
  console.log(`\n  💾 Updating ${cityLocalNames.size} cities with local names...`);

  const entries = Array.from(cityLocalNames.entries());
  const batchSize = 1000;
  let totalUpdated = 0;

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);

    // AI : Build a SQL CASE statement for batch update
    // AI : UPDATE cities SET name_local = CASE
    // AI :   WHEN id = 123 THEN 'Tokyo'
    // AI :   WHEN id = 456 THEN 'Moscow'
    // AI :   ...
    // AI : END WHERE id IN (123, 456, ...)

    const cityIds = batch.map(([cityId]) => cityId);
    const caseStatements = batch
      .map(([cityId, { name }]) => {
        // AI : Escape single quotes in SQL strings
        const escapedName = name.replace(/'/g, "''");
        return `WHEN ${cityId} THEN '${escapedName}'`;
      })
      .join(" ");

    await db.execute(
      sql.raw(`
      UPDATE cities 
      SET name_local = CASE id 
        ${caseStatements}
      END
      WHERE id IN (${cityIds.join(",")})
    `),
    );

    totalUpdated += batch.length;
    console.log(`    ✓ Updated ${totalUpdated} cities...`);
  }

  console.log(`✅ Updated ${totalUpdated} cities with local names`);
}

/**
 * AI : Main import function
 */
async function main() {
  console.log("🌍 GeoNames Import Script");
  console.log("=".repeat(50));

  try {
    // AI : Check required files
    if (!fs.existsSync(GEONAMES_DIR)) {
      console.error(`\n❌ GeoNames data directory not found: ${GEONAMES_DIR}`);
      console.log("\nPlease create the directory and download the following files:");
      console.log(
        "  1. countryInfo.txt - https://download.geonames.org/export/dump/countryInfo.txt",
      );
      console.log(
        "  2. cities15000.txt - https://download.geonames.org/export/dump/cities15000.zip",
      );
      console.log("\nOptional (for local names):");
      console.log(
        "  3. alternateNamesV2.csv - https://download.geonames.org/export/dump/alternateNamesV2.zip",
      );
      process.exit(1);
    }

    if (!fs.existsSync(COUNTRIES_CSV)) {
      console.error(`\n❌ countries.csv not found: ${COUNTRIES_CSV}`);
      process.exit(1);
    }

    const startTime = Date.now();

    // AI : Step 1: Load country coordinates from CSV
    await loadCountryCoordinates();

    // AI : Step 2: Load country languages (for local name filtering)
    await loadCountryLanguages();

    // AI : Step 3: Import countries
    await importCountries();

    // AI : Step 4: Import cities
    await importCities();

    // AI : Step 5: Update local names (if alternateNames file exists)
    await updateCityLocalNames();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✅ Import completed successfully in ${duration}s`);
    console.log("\n💡 Next steps:");
    console.log("  - Verify imported data in your database");
    console.log("  - Update project city_id values as needed");
    console.log("  - Test city search with both English and local names");

    process.exit(0);
  } catch (error) {
    console.error("\n❌ Import failed:", error);
    process.exit(1);
  }
}

// AI : Run the import
await main();
