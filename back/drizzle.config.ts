// used by scripts in package.json, not imported by any code
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  extensionsFilters: ["postgis"], // To prevent drizzle migrations from trying to delete 'spatial_ref_sys' table
  dbCredentials: {
    url: process.env.DATABASE_URL as string,
    ssl: {
      rejectUnauthorized: false,
    },
  },
});
