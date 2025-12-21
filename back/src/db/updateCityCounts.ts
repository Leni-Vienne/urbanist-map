import { db } from "../database";
import { cities } from "./schema";
import { eq, sql } from "drizzle-orm";

/**
 * AI : Increment a city's approved project count atomically
 * AI : Used when approving a project
 * @param cityId - The city ID to update
 */
export async function incrementCityProjectCount(cityId: number): Promise<void> {
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
export async function decrementCityProjectCount(cityId: number): Promise<void> {
  await db
    .update(cities)
    .set({ approvedProjectCount: sql`GREATEST(${cities.approvedProjectCount} - 1, 0)` })
    .where(eq(cities.id, cityId));
}
