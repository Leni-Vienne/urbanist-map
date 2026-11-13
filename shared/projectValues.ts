// Array order is significant: a project's first tag controls its color and icon.
export function projectValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
