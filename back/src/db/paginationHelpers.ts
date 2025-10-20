import { sql, eq, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { db } from '../database';
import { projects, cities } from './schema';

// AI : ============================================================================
// AI : PAGINATION HELPERS - Reusable pagination logic for tRPC endpoints
// AI : ============================================================================
// AI : These helpers eliminate duplicate cursor-based pagination patterns
// AI : ============================================================================

/**
 * AI : Standard pagination input filters used across multiple endpoints
 */
export interface PaginationFilters {
  cityId?: string;
  countryCode?: string;
  cursor?: string;
}

/**
 * AI : Build common filter conditions for pagination queries
 * AI : Adds cityId, countryCode, and cursor-based pagination conditions
 *
 * @param filters - Object containing optional cityId, countryCode, and cursor
 * @param sortColumn - The column used for sorting (determines cursor comparison)
 * @returns Array of SQL conditions to be used in where clauses
 */
export async function buildPaginationConditions(
  filters: PaginationFilters,
  sortColumn: PgColumn
): Promise<SQL[]> {
  const conditions: SQL[] = [];

  if (filters.cityId) {
    conditions.push(eq(projects.cityId, filters.cityId));
  }

  if (filters.countryCode) {
    conditions.push(eq(cities.countryCode, filters.countryCode));
  }

  // AI : Cursor-based pagination: fetch records after the cursor position
  if (filters.cursor) {
    const cursorProject = await db
      .select({ sortValue: sortColumn })
      .from(projects)
      .where(eq(projects.id, filters.cursor))
      .limit(1);

    if (cursorProject.length > 0) {
      conditions.push(sql`${sortColumn} < ${cursorProject[0].sortValue}`);
    }
  }

  return conditions;
}

/**
 * AI : Build pagination response with nextCursor and hasMore flag
 *
 * @param results - Array of query results
 * @param limit - The requested limit
 * @returns Object with paginated items and pagination metadata
 */
export function buildPaginationResponse<T extends { id: string }>(
  results: T[],
  limit: number
): {
  items: T[];
  pagination: { nextCursor: string | null; hasMore: boolean };
} {
  const hasMore = results.length > limit;
  const items = hasMore ? results.slice(0, limit) : results;
  const lastItem = items[items.length - 1];

  return {
    items,
    pagination: {
      nextCursor: hasMore && lastItem ? lastItem.id : null,
      hasMore
    }
  };
}
