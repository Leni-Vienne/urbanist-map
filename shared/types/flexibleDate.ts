export type DatePrecision = "year" | "month" | "day";

export interface FlexibleDate {
  date: Date;
  precision: DatePrecision;
}

export interface FlexibleDateInput {
  year: number;
  month?: number; // 1-12
  day?: number; // 1-31
  precision: DatePrecision;
}
