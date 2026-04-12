import { db } from "../database";
import { cities } from "./schema";
import { eq, sql } from "drizzle-orm";

// Used when approving a project
export async function incrementCityProjectCount(cityId: number): Promise<void> {
  await db
    .update(cities)
    .set({ approvedProjectCount: sql`${cities.approvedProjectCount} + 1` })
    .where(eq(cities.id, cityId));
}

// Used when rejecting an approved project
export async function decrementCityProjectCount(cityId: number): Promise<void> {
  await db
    .update(cities)
    .set({ approvedProjectCount: sql`GREATEST(${cities.approvedProjectCount} - 1, 0)` })
    .where(eq(cities.id, cityId));
}
