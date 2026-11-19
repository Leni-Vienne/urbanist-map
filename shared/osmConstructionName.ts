const NON_DESCRIPTIVE_CONSTRUCTION_VALUES = new Set([
  "",
  "yes",
  "no",
  "construction",
  "proposed",
  "planned",
]);

export function formatConstructionName(value: string): string | null {
  const normalized = value.trim().replaceAll("_", " ").replace(/\s+/g, " ");
  if (NON_DESCRIPTIVE_CONSTRUCTION_VALUES.has(normalized.toLowerCase())) return null;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
