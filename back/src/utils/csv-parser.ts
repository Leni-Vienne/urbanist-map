// AI : Shared CSV parsing utilities to eliminate duplication between import services

/**
 * AI : Parse a CSV line handling quoted values and escaped commas
 * This utility handles proper CSV parsing including quotes and commas within fields
 */
export function parseCSVLine(line: string): string[] {
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
 * AI : Basic CSV file reader with error handling
 * Returns an array of parsed lines excluding the header
 */
export function parseCSVContent(csvContent: string): string[][] {
  const lines = csvContent.split('\n').filter(line => line.trim());
  
  if (lines.length === 0) {
    throw new Error('Empty CSV file');
  }

  const dataLines = lines.slice(1); // Skip header
  const parsedData: string[][] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i].trim();
    if (!line) continue;

    try {
      const fields = parseCSVLine(line);
      parsedData.push(fields);
    } catch (error) {
      console.error(`AI : Error parsing line ${i + 2}: ${line}`, error);
    }
  }

  return parsedData;
}