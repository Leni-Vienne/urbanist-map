export const MIN_LOCATION_SEARCH_ALNUM = 3;

export function countAlphanumeric(value: string): number {
  return value.replace(/[^\p{L}\p{N}]/gu, "").length;
}
