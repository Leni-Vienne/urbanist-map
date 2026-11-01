export const DATE_PRECISION_VALUES = ["year", "month", "day"] as const;
export type DatePrecision = (typeof DATE_PRECISION_VALUES)[number];

export interface FlexibleDateInput {
  year: number;
  month?: number; // 1-12
  day?: number; // 1-31
  precision: DatePrecision;
}
