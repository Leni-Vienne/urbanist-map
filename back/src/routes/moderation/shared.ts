import { eq } from "drizzle-orm";
import { projects, overlays } from "../../db/schema";
import { db } from "../../database";
import { TRPCError } from "@trpc/server";

export type ModeratorUser = { role: string | null; moderatedCountries: string[] | null };

// Enforces that the moderator may act on a resolved country row (undefined when the entity is
// missing). Returns the country code, throwing NOT_FOUND / FORBIDDEN otherwise.
function assertModeratorCountry(
  user: ModeratorUser,
  row: { countryCode: string } | undefined,
  notFoundMessage: string,
): string {
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: notFoundMessage });
  }

  if (!user.moderatedCountries?.includes(row.countryCode)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to moderate content in this country",
    });
  }

  return row.countryCode;
}

// Returns a project's country code if the moderator may act on it (admins get the "*" wildcard).
export async function checkModeratorCountryPermission(
  projectId: string,
  user: ModeratorUser,
): Promise<string> {
  if (user.role === "admin") {
    return "*"; // Wildcard indicating all countries allowed
  }

  const rows = await db
    .select({ countryCode: projects.countryCode })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  return assertModeratorCountry(user, rows[0], "Project not found");
}

// Same permission check, resolving the country through the overlay's project.
export async function checkModeratorOverlayPermission(
  overlayId: string,
  user: ModeratorUser,
): Promise<string> {
  if (user.role === "admin") {
    return "*";
  }

  const rows = await db
    .select({ countryCode: projects.countryCode })
    .from(overlays)
    .innerJoin(projects, eq(overlays.projectId, projects.id))
    .where(eq(overlays.id, overlayId))
    .limit(1);

  return assertModeratorCountry(user, rows[0], "Overlay not found");
}
