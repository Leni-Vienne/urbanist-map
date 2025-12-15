import { db } from "../database";
import { cities, projects } from "./schema";
import { eq, sql, and } from "drizzle-orm";

/**
 * AI : Update the approved project count for a specific city
 * AI : Called after project approval/rejection in moderation
 * @param cityId - The city ID to update
 */
export async function updateCityProjectCount(cityId: string): Promise<void> {
  // AI : Count approved projects in this city
  const result = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(projects)
    .where(and(eq(projects.cityId, cityId), eq(projects.status, "approved")));

  const count = result[0]?.count ?? 0;

  // AI : Update the city's approved project count
  await db.update(cities).set({ approvedProjectCount: count }).where(eq(cities.id, cityId));
}

/**
 * AI : Increment a city's approved project count atomically
 * AI : Used when approving a project
 * @param cityId - The city ID to update
 */
export async function incrementCityProjectCount(cityId: string): Promise<void> {
  await db
    .update(cities)
    .set({ approvedProjectCount: sql`${cities.approvedProjectCount} + 1` })
    .where(eq(cities.id, cityId));
}

/**
 * AI : Decrement a city's approved project count atomically
 * AI : Used when rejecting an approved project
 * @param cityId - The city ID to update
 */
export async function decrementCityProjectCount(cityId: string): Promise<void> {
  await db
    .update(cities)
    .set({ approvedProjectCount: sql`GREATEST(${cities.approvedProjectCount} - 1, 0)` })
    .where(eq(cities.id, cityId));
}
