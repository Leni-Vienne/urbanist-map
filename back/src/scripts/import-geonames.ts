// instructions in /docs/GEONAMES_IMPORT.md

import { db } from "../database";
import { countries, cities } from "../db/schema";
import { sql } from "drizzle-orm";
import * as fs from "node:fs";
import * as readline from "node:readline";
import * as path from "node:path";
import { parseCSVLine } from "../utils/csv-parser";

const GEONAMES_DIR = path.join(process.cwd(), "./back/src/scripts/geonames-data");
const COUNTRIES_CSV = path.join(GEONAMES_DIR, "countries.csv");
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

// Mapping from ISO alpha-2 to alpha-3
const alpha2ToAlpha3Map = new Map<string, string>();
// Country to main language mapping (for local names)
const countryLanguageMap = new Map<string, string>();
// City ID to country code mapping (for local name filtering)
const cityCountryMap = new Map<number, string>();
// City ID to ASCII name mapping (to skip duplicate alternate names)
const cityNameMap = new Map<number, string>();
// Country coordinates from CSV
const countryCoordinates = new Map<string, { lat: number; lng: number }>();

/**
 * Load country coordinates from countries.csv
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
    lineNumber += 1;

    // Skip header line
    if (lineNumber === 1) continue;

    // Parse CSV with proper handling of quoted fields
    // Country names can contain commas (e.g., "Korea, Republic of")
    const fields = parseCSVLine(line);
    if (fields.length >= 6) {
      // Column 1: Alpha-2 code that we don't use, at least for now
      const alpha3 = fields[2]; // Alpha-3 code
      const lat = Number.parseFloat(fields[4]!);
      const lng = Number.parseFloat(fields[5]!);

      if (alpha3 && !Number.isNaN(lat) && !Number.isNaN(lng)) {
        countryCoordinates.set(alpha3, { lat, lng });
      }
    }
  }

  console.log(`  ✓ Loaded coordinates for ${countryCoordinates.size} countries`);
}

/**
 * Load country language mappings from countryInfo.txt
 * This is needed to identify the main language for each country
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
    // Skip comments
    if (line.startsWith("#") || line.trim() === "") continue;

    const fields = line.split("\t");
    if (fields.length > 15) {
      const iso2 = fields[0]!.trim();
      const iso3 = fields[1]!.trim();
      // Languages field contains comma-separated codes, take the first one
      const rawLang = fields[15]!.split(",")[0]!.split("-")[0]!.trim();

      if (iso2 && iso3 && rawLang) {
        alpha2ToAlpha3Map.set(iso2, iso3);
        countryLanguageMap.set(iso3, rawLang); // Use alpha-3 for consistency
      }
    }
  }

  console.log(`  ✓ Loaded languages for ${countryLanguageMap.size} countries`);
}

/**
 * Parse countryInfo.txt and import countries with actual coordinates
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
    // Skip comments and empty lines
    if (line.startsWith("#") || line.trim() === "") continue;

    const fields = line.split("\t");
    if (fields.length < 17) continue;

    const [
      iso2, // 0: ISO alpha-2
      iso3, // 1: ISO alpha-3
      _isoNumeric, // 2: ISO numeric
      _fips, // 3: FIPS code
      countryName, // 4: Country name
      _capital, // 5: Capital
      _area, // 6: Area
      _population, // 7: Population
      _continent, // 8: Continent
      _tld, // 9: TLD
      _currencyCode, // 10: Currency
      _currencyName, // 11: Currency name
      _phone, // 12: Phone prefix
      _postalCodeFormat, // 13: Postal code format
      _postalCodeRegex, // 14: Postal code regex
      _languages, // 15: Languages
      geonameId, // 16: GeoNames ID
    ] = fields;

    // Skip entries without proper data
    if (!iso2 || !iso3 || !geonameId || !countryName) continue;

    // Get coordinates from countries.csv
    const coords = countryCoordinates.get(iso3);
    if (!coords) {
      console.warn(`⚠️  No coordinates for ${countryName} (${iso3})`);
      continue;
    }

    countryBatch.push({
      id: Number.parseInt(geonameId, 10),
      code: iso3,
      code2: iso2,
      name: countryName,
      latitude: coords.lat,
      longitude: coords.lng,
    });

    // Insert in batches
    if (countryBatch.length >= BATCH_SIZE) {
      await insertCountryBatch(countryBatch);
      importedCount += countryBatch.length;
      console.log(`  ✓ Imported ${importedCount} countries...`);
      countryBatch.length = 0;
    }
  }

  // Insert remaining countries
  if (countryBatch.length > 0) {
    await insertCountryBatch(countryBatch);
    importedCount += countryBatch.length;
  }

  console.log(`✅ Imported ${importedCount} countries total`);
}

/**
 * Insert country batch into database
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
 * Parse cities15000.txt and import cities (without local names initially)
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
      _name, // 1: Name (can have accents like "Zürich")
      asciiname, // 2: ASCII name (no accents like "Zurich")
      _alternateNames, // 3: Alternate names
      latitude, // 4: Latitude
      longitude, // 5: Longitude
      _featureClass, // 6: Feature class
      featureCode, // 7: Feature code (PPL, PPLC, PPLX, etc.)
      countryCode2, // 8: Country code (ISO alpha-2)
    ] = fields;

    if (!geonameId || !asciiname || !latitude || !longitude || !countryCode2) {
      skippedCount += 1;
      continue;
    }

    // Only import actual cities (not streets, markets, historical places, etc.)
    // Allowed feature codes:
    //   PPL - populated place (city/town)
    //   PPLC - capital city
    //   PPLA, PPLA2, PPLA3, PPLA4 - administrative seats
    const allowedFeatureCodes = ["PPL", "PPLC", "PPLA", "PPLA2", "PPLA3", "PPLA4"];
    if (!featureCode) {
      skippedCount += 1;
      continue;
    }
    if (!allowedFeatureCodes.includes(featureCode)) {
      skippedCount += 1;
      continue;
    }

    // Convert country code from alpha-2 to alpha-3
    const countryCode3 = alpha2ToAlpha3Map.get(countryCode2);
    if (!countryCode3) {
      skippedCount += 1;
      continue;
    }

    const cityId = Number.parseInt(geonameId, 10);

    // Store mapping for local name processing
    cityCountryMap.set(cityId, countryCode3);
    cityNameMap.set(cityId, asciiname);

    cityBatch.push({
      id: cityId,
      name: asciiname,
      nameLocal: null, // Will be updated by updateCityLocalNames()
      countryCode: countryCode3,
      latitude: Number.parseFloat(latitude),
      longitude: Number.parseFloat(longitude),
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
 * Insert city batch into database
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
 * Update city local names from alternateNamesV2.txt
 * Logic inspired by alternateName.py - prioritizes native language names
 */
// eslint-disable-next-line @eslint/complexity
async function updateCityLocalNames(): Promise<void> {
  console.log("\n🌐 Processing local names from alternateNamesV2.txt... (may take a minute)");
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

  // Map to store best local name for each city
  const cityLocalNames = new Map<number, { name: string; priority: number }>();
  // Map to store English alternate names (to prefer over romanized names)
  const cityEnglishNames = new Map<number, string>();

  let processedCount = 0;
  for await (const line of rl) {
    const fields = line.split("\t");
    if (fields.length < 5) continue;

    const geonameId = Number.parseInt(fields[1]!, 10);
    const lang = fields[2]; // Language code
    const alternateName = fields[3];

    if (!alternateName) {
      continue;
    }

    // Column 4: preferred name
    const isShortName = fields[5] === "1"; // Column 5: short name flag
    const isColloquial = fields[6] === "1"; // Column 6: colloquial name flag
    const isHistoric = fields[7] === "1"; // Column 7: historic name flag

    // Skip colloquial, historical, and short name variants
    // Examples: "Ville-Lumière" (colloquial), "Lutetia" (historical), "NYC" (short)
    // We want actual proper names, not nicknames or old names
    if (isColloquial || isHistoric || isShortName) {
      continue;
    }

    // Skip Wikipedia/Wikidata URLs and other non-name entries
    // GeoNames uses specific pseudo language codes for these:
    // - 'link': Wikipedia URLs
    // - 'wkdt': Wikidata URLs
    // - 'unlc': UN location codes
    // - 'iata', 'icao', 'faac', 'tcid': Airport codes
    // - 'abbr': Abbreviations
    // - 'post': Postal codes
    // - 'phon': Phonetics
    // - 'piny': Pinyin
    // - 'nuts': EU NUTS codes
    // - 'lauc': EU LAU codes
    if (
      lang === "link" ||
      lang === "wkdt" ||
      lang === "unlc" ||
      lang === "iata" ||
      lang === "icao" ||
      lang === "faac" ||
      lang === "tcid" ||
      lang === "abbr" ||
      lang === "post" ||
      lang === "phon" ||
      lang === "piny" ||
      lang === "nuts" ||
      lang === "lauc"
    ) {
      continue;
    }

    // Also skip if it looks like a URL (backup check)
    if (alternateName.startsWith("http://") || alternateName.startsWith("https://")) {
      continue;
    }

    // Skip numeric-only values (postal codes, IDs, etc.)
    if (/^\d+$/.test(alternateName.trim())) {
      continue;
    }

    // Only process cities we imported
    const countryCode = cityCountryMap.get(geonameId);
    if (!countryCode) continue;

    // Capture English alternate names to use as main city name
    // This gives us clean English names like "10th of Ramadan City"
    // instead of romanized names with diacritics like "Al 'Āshir min Ramaḑān"
    if (lang === "en") {
      const cityName = cityNameMap.get(geonameId);
      // Only use if different from current name (avoid duplicates)
      if (cityName && alternateName !== cityName) {
        cityEnglishNames.set(geonameId, alternateName);
      }
      continue; // Don't use English names as local names
    }

    const targetLang = countryLanguageMap.get(countryCode);

    // Skip if the alternate name is identical to the main ASCII name
    // This prevents redundant local names (e.g., "Paris" vs "Paris")
    const cityName = cityNameMap.get(geonameId);
    if (cityName && alternateName === cityName) {
      continue;
    }

    // Skip local names for English-speaking countries entirely
    // For these countries, the ASCII name is already correct
    // This prevents other languages from being used since it's not needed for those countries
    const englishSpeakingCountries = new Set(["USA", "GBR", "CAN", "AUS", "NZL", "IRL"]);
    if (englishSpeakingCountries.has(countryCode)) {
      continue;
    }

    // Priority system:
    // If we know the target language:
    //   - Priority 100: Names matching target language (e.g., 'ja' for Japan)
    //   - Priority 50: Unlabeled names with non-ASCII (fallback)
    //   - Skip: Other languages (prevents Russian names on Japanese cities, etc.)
    // If we don't know the target language:
    //   - Priority 75: Any language with non-ASCII (best guess)
    //   - Priority 50: Unlabeled with non-ASCII
    //   - Skip: Latin-only names

    let priority = 0;
    if (targetLang) {
      // We know the target language - be strict
      if (lang === targetLang) {
        priority = 100; // Exact language match
      } else if (lang === "" && /[^ -~]/.test(alternateName)) {
        priority = 50; // Unlabeled with non-ASCII
      } else {
        continue; // Skip other languages to prevent cross-contamination
      }
    } else if (lang && lang !== "" && /[^ -~]/.test(alternateName)) {
      // We don't know the target language - accept any non-ASCII
      priority = 75; // Any language with non-ASCII
    } else if (lang === "" && /[^ -~]/.test(alternateName)) {
      priority = 50; // Unlabeled with non-ASCII
    } else {
      continue; // Skip Latin-only names
    }

    // Only update if this is better than what we have
    const existing = cityLocalNames.get(geonameId);
    if (!existing || priority > existing.priority) {
      cityLocalNames.set(geonameId, { name: alternateName, priority });
    }

    processedCount += 1;
    if (processedCount % 100_000 === 0) {
      console.log(`  ⏳ Processed ${processedCount} name records...`);
    }
  }

  // Update cities in database using batch SQL for performance
  console.log(`\n  💾 Updating ${cityLocalNames.size} cities with local names...`);

  const entries = [...cityLocalNames.entries()];
  const batchSize = 1000;
  let totalUpdated = 0;

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);

    const valuesSql = sql.join(
      batch.map(([cityId, { name }]) => sql`(${cityId}, ${name})`),
      sql`, `,
    );

    await db.execute(
      sql`
      UPDATE cities
      SET name_local = u.name
      FROM (VALUES ${valuesSql}) AS u(id, name)
      WHERE cities.id = u.id::int
    `,
    );

    totalUpdated += batch.length;
    console.log(`    ✓ Updated ${totalUpdated} cities...`);
  }

  console.log(`✅ Updated ${totalUpdated} cities with local names`);

  // Update cities with English alternate names (for main name field)
  console.log(`\n  💾 Updating ${cityEnglishNames.size} cities with English names...`);

  const englishEntries = [...cityEnglishNames.entries()];
  let totalEnglishUpdated = 0;

  for (let i = 0; i < englishEntries.length; i += batchSize) {
    const batch = englishEntries.slice(i, i + batchSize);

    const valuesSql = sql.join(
      batch.map(([cityId, name]) => sql`(${cityId}, ${name})`),
      sql`, `,
    );

    await db.execute(
      sql`
      UPDATE cities
      SET name = u.name
      FROM (VALUES ${valuesSql}) AS u(id, name)
      WHERE cities.id = u.id::int
    `,
    );

    totalEnglishUpdated += batch.length;
    console.log(`    ✓ Updated ${totalEnglishUpdated} cities with English names...`);
  }

  console.log(`✅ Updated ${totalEnglishUpdated} cities with English names`);
}

/**
 * Main import function
 */
async function main() {
  console.log("🌍 GeoNames Import Script");
  console.log("=".repeat(50));

  try {
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
      //eslint-disable-next-line no-process-exit
      process.exit(1);
    }

    if (!fs.existsSync(COUNTRIES_CSV)) {
      console.error(`\n❌ countries.csv not found: ${COUNTRIES_CSV}`);
      //eslint-disable-next-line no-process-exit
      process.exit(1);
    }

    const startTime = Date.now();

    // Step 1: Load country coordinates from CSV
    await loadCountryCoordinates();

    // Step 2: Load country languages (for local name filtering)
    await loadCountryLanguages();

    // Step 3: Import countries
    await importCountries();

    // Step 4: Import cities
    await importCities();

    // Step 5: Update local names (if alternateNames file exists)
    await updateCityLocalNames();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✅ Import completed successfully in ${duration}s`);
    console.log("\n💡 Next steps:");
    console.log("  - Verify imported data in your database");
    console.log("  - Update project city_id values as needed");
    console.log("  - Test city search with both English and local names");
    //eslint-disable-next-line no-process-exit
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Import failed:", error);
    //eslint-disable-next-line no-process-exit
    process.exit(1);
  }
}

// Run the import
await main();
