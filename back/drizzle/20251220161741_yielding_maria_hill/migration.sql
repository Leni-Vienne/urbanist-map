-- This migration converts cities and countries from UUID to integer IDs (GeoNames-based)
-- WARNING: This will delete all existing city and country data
-- This is acceptable for development environments transitioning to GeoNames

-- Step 1: Drop foreign key constraints that reference cities
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_city_id_cities_id_fk";-->statement-breakpoint

-- Step 2: Drop existing cities and countries tables
DROP TABLE IF EXISTS "cities" CASCADE;-->statement-breakpoint
DROP TABLE IF EXISTS "countries" CASCADE;-->statement-breakpoint

-- Step 3: Recreate countries table with integer ID and code2
CREATE TABLE "countries" (
    "id" integer PRIMARY KEY,
    "code" char(3) NOT NULL UNIQUE,
    "code2" char(2) NOT NULL UNIQUE,
    "name" text NOT NULL,
    "center_coordinates" geometry(point, 4326) NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);-->statement-breakpoint

-- Step 4: Recreate cities table with integer ID and nameLocal
CREATE TABLE "cities" (
    "id" integer PRIMARY KEY,
    "name" text NOT NULL,
    "name_local" text,
    "country_code" char(3) NOT NULL,
    "coordinates" geometry(point, 4326) NOT NULL,
    "approved_project_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);-->statement-breakpoint

-- Step 5: Create indexes for both tables
CREATE INDEX "idx_countries_code" ON "countries" USING btree ("code");-->statement-breakpoint
CREATE INDEX "idx_countries_code2" ON "countries" USING btree ("code2");-->statement-breakpoint
CREATE INDEX "idx_countries_center" ON "countries" USING GIST ("center_coordinates");-->statement-breakpoint
CREATE INDEX "idx_cities_country" ON "cities" USING btree ("country_code");-->statement-breakpoint
CREATE INDEX "idx_cities_name" ON "cities" USING btree ("name");-->statement-breakpoint
CREATE INDEX "idx_cities_name_local" ON "cities" USING btree ("name_local");-->statement-breakpoint
CREATE INDEX "idx_cities_coordinates" ON "cities" USING GIST ("coordinates");-->statement-breakpoint

-- Step 6: Drop and recreate projects.city_id as integer (can't cast UUID to integer)
ALTER TABLE "projects" DROP COLUMN "city_id";-->statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "city_id" integer;-->statement-breakpoint

-- Step 7: Re-add foreign key constraint
ALTER TABLE "projects" ADD CONSTRAINT "projects_city_id_cities_id_fk" 
    FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE set null ON UPDATE cascade;-->statement-breakpoint