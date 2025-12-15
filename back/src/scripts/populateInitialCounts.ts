import { db } from "../database";
import { cities, projects } from "../db/schema";
import { sql, eq, count, isNotNull } from "drizzle-orm";

/**
 * AI : One-time script to populate initial approved project counts for all cities
 * AI : Safe to re-run (idempotent) - recalculates from scratch
 * AI : Run this after adding the approvedProjectCount column to the schema
 */
async function populateInitialCounts() {
  console.log("Starting to populate city project counts...");

  try {
    // AI : Get all cities with their approved project counts using Drizzle
    // AI : Create subquery for project counts per city
    const projectCountsSubquery = db
      .select({
        cityId: projects.cityId,
        count: count(projects.id).as("count"),
      })
      .from(projects)
      .where(eq(projects.status, "approved"))
      .groupBy(projects.cityId)
      .as("project_counts");

    // AI : Get city IDs with their counts from the subquery
    const citiesWithCounts = await db
      .select({
        cityId: projectCountsSubquery.cityId,
        projectCount: projectCountsSubquery.count,
      })
      .from(projectCountsSubquery)
      .where(isNotNull(projectCountsSubquery.cityId));

    // AI : Update each city with its count
    let updatedCount = 0;
    for (const { cityId, projectCount } of citiesWithCounts) {
      if (cityId) {
        await db
          .update(cities)
          .set({ approvedProjectCount: Number(projectCount) })
          .where(eq(cities.id, cityId));
        updatedCount++;
      }
    }

    console.log(`✓ Updated ${updatedCount} cities with approved projects`);

    // AI : Reset cities with no approved projects to 0
    // AI : Get all city IDs that have projects
    const cityIdsWithProjects = citiesWithCounts
      .map((c) => c.cityId)
      .filter((id): id is string => id !== null);

    // AI : Update all cities not in that list to have count 0
    if (cityIdsWithProjects.length > 0) {
      await db
        .update(cities)
        .set({ approvedProjectCount: 0 })
        .where(sql`${cities.id} NOT IN ${cityIdsWithProjects}`);
    }

    console.log(`✓ Reset cities with no approved projects to 0`);

    // AI : Verify results with proper Drizzle select
    const stats = await db
      .select({
        citiesWithProjects: count(cities.id).as("cities_with_projects"),
        totalCities: count(cities.id).as("total_cities"),
        totalProjects: sql<number>`SUM(${cities.approvedProjectCount})`.as("total_projects"),
      })
      .from(cities)
      .where(sql`${cities.approvedProjectCount} > 0`)
      .union(
        db
          .select({
            citiesWithProjects: sql<number>`0`.as("cities_with_projects"),
            totalCities: count(cities.id).as("total_cities"),
            totalProjects: sql<number>`0`.as("total_projects"),
          })
          .from(cities),
      );

    console.log("\n=== Summary ===");
    console.log(`Cities with projects: ${updatedCount}`);
    console.log(
      `Total cities: ${stats.length > 1 ? Number(stats[0].totalCities) + Number(stats[1].totalCities) : stats[0].totalCities}`,
    );
    console.log(
      `Total approved projects: ${citiesWithCounts.reduce((sum, c) => sum + Number(c.projectCount), 0)}`,
    );
    console.log("\n✓ Population complete!");

    process.exit(0);
  } catch (error) {
    console.error("Error populating counts:", error);
    process.exit(1);
  }
}

// AI : Run the script
await populateInitialCounts();
