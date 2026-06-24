// Deterministic, permanent project slug generation, shared by the OSM import, the user-create
// mutation and the one-time backfill. The slug must stay stable for the life of a project's URL:
// it is derived from the project's natural key (the OSM external id, else the row uuid), never from
// a sequential counter, so a hard-deleted OSM feature that reappears regenerates the identical slug
// (its indexed URL survives the prune/recreate cycle).

const MAX_BASE_LENGTH = 60;

// Accent-fold, lowercase, replace any run of non-alphanumerics with a single hyphen, trim hyphens
// and cap the length. Returns "" when the name has no usable alphanumeric content (the suffix then
// carries the whole slug).
function slugifyName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics left by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/g, ""); // re-trim in case the slice landed on a hyphen
}

// "relation/19141658" -> "r19141658", "way/789" -> "w789", "node/42" -> "n42".
// The type letter prevents a way and a relation that share a numeric id from colliding.
function fromExternalId(externalId: string): string {
  const [type, id] = externalId.split("/", 2);
  const letter = type?.[0]?.toLowerCase() ?? "x";
  const numeric = (id ?? "").replace(/[^a-z0-9]/gi, "");
  return `${letter}${numeric}`;
}

// "u" + base36 of the first 5 bytes (10 hex chars) of the row uuid. 40 bits is ample entropy for
// the handful of user-created projects, and the unique constraint on projects.slug is the backstop.
function fromUuid(id: string): string {
  const hex = id.replace(/-/g, "").slice(0, 10);
  const value = Number.parseInt(hex, 16);
  return `u${Number.isNaN(value) ? hex : value.toString(36)}`;
}

// Build the permanent slug. externalId wins when present (OSM rows); user rows fall back to the
// uuid-derived suffix. The suffix alone guarantees uniqueness, so a name-less project still gets a
// valid slug.
export function buildProjectSlug(input: {
  name: string | null | undefined;
  externalId: string | null | undefined;
  id?: string | null;
}): string {
  const base = slugifyName(input.name);
  // externalId rows (OSM) never need the uuid; user rows always pass id.
  const suffix = input.externalId ? fromExternalId(input.externalId) : fromUuid(input.id ?? "");
  return base ? `${base}-${suffix}` : suffix;
}
