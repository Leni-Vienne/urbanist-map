import { defineConfig } from 'drizzle-kit';
import { resolve } from 'path';

export default defineConfig({
    out: resolve(__dirname, './drizzle'),
    schema: resolve(__dirname, './src/db/schema.ts'),
    dialect: 'postgresql',
    extensionsFilters: ['postgis'], // To prevent drizzle migrations from trying to delete 'spatial_ref_sys' table
    dbCredentials: {
        url: process.env.DATABASE_URL!,
        ssl: {
            rejectUnauthorized: false,
        }
    },
});