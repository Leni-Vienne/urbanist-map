import dotenv from 'dotenv';
import { defineConfig } from 'drizzle-kit';

dotenv.config({ path: '../.env' });

export default defineConfig({
    out: './drizzle',
    schema: './src/db/schema.ts',
    dialect: 'postgresql',
    extensionsFilters: ['postgis'], // To prevent drizzle migrations fro trying to delete 'spatial_ref_sys' table
    dbCredentials: {
        url: process.env.POSTGRES_URL!,
    },
});