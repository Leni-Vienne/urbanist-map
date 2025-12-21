# GeoNames Import Guide

This guide explains how to populate the `countries` and `cities` tables using GeoNames data.

## Prerequisites

Download the following files from [GeoNames](https://download.geonames.org/export/dump/):

1. **countryInfo.txt** - Country information with ISO codes
   - Direct link: https://download.geonames.org/export/dump/countryInfo.txt
   - Contains: ISO alpha-2, ISO alpha-3, country names

2. **cities15000.txt** - Cities with population > 15,000
   - Direct link: https://download.geonames.org/export/dump/cities15000.zip
   - Contains: City names, coordinates, country codes
   - **Note**: Extract the .zip file to get cities15000.txt

3. **alternateNames.txt** (Optional) - For local city names
   - Direct link: https://download.geonames.org/export/dump/alternateNames.zip
   - Enables searching cities in local languages (Japanese, Russian, etc.)

## Setup

1. Create a directory for GeoNames data:

   ```bash
   mkdir geonames-data
   ```

2. Download and place the files in the `geonames-data/` directory:
   ```
   geonames-data/
   ├── countryInfo.txt
   ├── cities15000.txt
   └── alternateNames.txt (optional)
   ```

## Running the Import

Execute the import script:

```bash
bun run back/src/scripts/import-geonames.ts
```

The script will:

1. Import ~250 countries with both ISO codes (alpha-2 and alpha3)
2. Import ~25,000 cities (population > 15,000)
3. Create PostGIS geometry points for spatial queries
4. Build indexes for fast lookups

**Expected Duration**: 30-60 seconds depending on your system

## What Gets Imported

### Countries Table

- `id`: GeoNames country ID (integer)
- `code`: ISO 3166-1 alpha-3 (3-letter, e.g., "FRA")
- `code2`: ISO 3166-1 alpha-2 (2-letter, e.g., "FR") - for flags
- `name`: Country name in English
- `centerCoordinates`: Approximate country center (PostGIS point)

### Cities Table

- `id`: GeoNames city ID (integer)
- `name`: City name (ASCII/English)
- `nameLocal`: Local name (null initially, populate with alternateNames)
- `countryCode`: ISO 3166-1 alpha-3 reference to countries
- `coordinates`: City coordinates (PostGIS point)
- `approvedProjectCount`: Initialize to 0

## Verifying the Import

Check imported data in your database:

```sql
-- Count countries
SELECT COUNT(*) FROM countries;

-- Count cities
SELECT COUNT(*) FROM cities;

-- Sample countries with both codes
SELECT id, code2, code, name FROM countries LIMIT 10;

-- Sample cities
SELECT id, name, country_code FROM cities LIMIT 10;
```

## Alternative: Smaller Dataset

If you want fewer cities (faster import, smaller database):

- **cities5000.txt**: Cities with population > 5,000 (~50,000 cities)
- **cities1000.txt**: Cities with population > 1,000 (~140,000 cities)

Just replace `cities15000.txt` with your preferred file and update the filename in the script.

## Next Steps

After importing:

1. **Add Local Names** (Optional):
   - Parse `alternateNames.txt` to populate `nameLocal` fields
   - Filter for official/preferred local names by language code

2. **Update Existing Projects**:
   - Map your existing project locations to the nearest city
   - Update `projects.city_id` to reference the new GeoNames cities

3. **Test Search Functionality**:
   - Search cities by English name
   - Search cities by local name (if populated)
   - Test spatial queries with PostGIS

## Troubleshooting

### "GeoNames data directory not found"

- Ensure the `geonames-data/` directory exists in your project root
- Check file paths and names match exactly

### "Cities file not found"

- Did you extract cities15000.zip? The import needs the .txt file
- Verify the file is named exactly `cities15000.txt`

### Cities skipped during import

- Cities from unknown countries are skipped (country must be imported first)
- This is normal if countryInfo.txt has fewer countries than cities file references

### Import is slow

- 25,000+ cities takes time (especially with PostGIS geometry creation)
- Consider using a smaller cities file for testing
- Batch size is set to 1000 - increasing it may help on powerful systems

## Data Attribution

GeoNames data is licensed under Creative Commons Attribution 4.0:

- Attribution required: "Data from GeoNames (geonames.org)"
- More info: https://www.geonames.org/
