import { z } from "zod";
import type { FlexibleDateInput } from "../types/flexibleDate";

export const flexibleDateSchema = z
  .object({
    year: z.number().int().min(1900).max(2200),
    month: z.number().int().min(1).max(12).optional(),
    day: z.number().int().min(1).max(31).optional(),
    precision: z.enum(["year", "month", "day"]),
  })
  .superRefine((data, ctx) => {
    // Validate precision matches provided fields
    if (data.precision === "day" && (!data.month || !data.day)) {
      ctx.addIssue({
        code: "custom",
        message: "validation.dayPrecisionRequiresFullDate",
      });
    }
    if (data.precision === "month" && !data.month) {
      ctx.addIssue({
        code: "custom",
        message: "validation.monthPrecisionRequiresMonth",
      });
    }
    // Validate day is valid for the month
    if (data.month && data.day) {
      const maxDay = new Date(data.year, data.month, 0).getDate();
      if (data.day > maxDay) {
        ctx.addIssue({
          code: "custom",
          message: "validation.invalidDayForMonth",
          path: ["day"],
        });
      }
    }
  });

// Helper to convert date to FlexibleDateInput (useful for initial values)
export function dateToFlexibleInput(
  date: Date,
  precision: "year" | "month" | "day" = "day",
): FlexibleDateInput {
  return {
    year: date.getFullYear(),
    month: precision !== "year" ? date.getMonth() + 1 : undefined,
    day: precision === "day" ? date.getDate() : undefined,
    precision,
  };
}
