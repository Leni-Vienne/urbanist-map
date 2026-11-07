function compareTags(left: string, right: string): number {
  return left.localeCompare(right);
}

// Tag order is presentation state; dates and structured fields compare by their wire value.
export function projectValuesEqual(field: string, left: unknown, right: unknown): boolean {
  if (field === "tags" && Array.isArray(left) && Array.isArray(right)) {
    return (
      JSON.stringify(left.toSorted(compareTags)) === JSON.stringify(right.toSorted(compareTags))
    );
  }
  return JSON.stringify(left) === JSON.stringify(right);
}
