CREATE TABLE "admin_boundaries" (
	"osm_id" text PRIMARY KEY NOT NULL,
	"admin_level" integer NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"name_en" text,
	"names" jsonb,
	"country_code" char(3),
	"geom" geometry(multipolygon, 4326),
	"import_source_id" uuid,
	"external_last_modified" timestamp with time zone,
	"last_imported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "idx_projects_import_source";--> statement-breakpoint
DROP INDEX "idx_projects_status";--> statement-breakpoint
DROP INDEX "idx_projects_owner_id";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "admin_boundary_id" text;--> statement-breakpoint
ALTER TABLE "admin_boundaries" ADD CONSTRAINT "admin_boundaries_parent_id_admin_boundaries_osm_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."admin_boundaries"("osm_id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "admin_boundaries" ADD CONSTRAINT "admin_boundaries_import_source_id_import_sources_id_fk" FOREIGN KEY ("import_source_id") REFERENCES "public"."import_sources"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "idx_admin_boundaries_admin_level" ON "admin_boundaries" USING btree ("admin_level");--> statement-breakpoint
CREATE INDEX "idx_admin_boundaries_parent" ON "admin_boundaries" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_admin_boundaries_country" ON "admin_boundaries" USING btree ("country_code");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_admin_boundary_id_admin_boundaries_osm_id_fk" FOREIGN KEY ("admin_boundary_id") REFERENCES "public"."admin_boundaries"("osm_id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "idx_projects_admin_boundary" ON "projects" USING btree ("admin_boundary_id");--> statement-breakpoint
CREATE INDEX "idx_projects_status" ON "projects" USING btree ("status") WHERE "projects"."status" <> 'approved';--> statement-breakpoint
CREATE INDEX "idx_projects_owner_id" ON "projects" USING btree ("owner_id") WHERE "projects"."owner_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "cities" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "countries" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "cities" CASCADE;--> statement-breakpoint
DROP TABLE "countries" CASCADE;--> statement-breakpoint
ALTER TABLE "admin_boundaries" DROP CONSTRAINT "admin_boundaries_import_source_id_import_sources_id_fk";
--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_city_id_cities_id_fk";
--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_country_code_countries_code_fk";
--> statement-breakpoint
ALTER TABLE "admin_boundaries" DROP COLUMN "import_source_id";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "city_id";
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_slug_unique" UNIQUE("slug");--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
-- IMMUTABLE wrapper so unaccent (declared STABLE) can be used in index expressions.
-- The two-arg form takes the dictionary explicitly, avoiding the catalog lookup that makes
-- the one-arg unaccent non-immutable. Everything is schema-qualified so it resolves during
-- index expression inlining regardless of search_path.
CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;--> statement-breakpoint
-- Punctuation-forgiving search normalization: strip everything that isn't alphanumeric
-- (apostrophes, dashes, spaces, dots, ...) on top of accent folding + lowercasing, so
-- "val de", "val-de" and "valde" all match "Val-de-Marne". Composed on immutable_unaccent
-- so it stays IMMUTABLE and usable in index expressions.
CREATE OR REPLACE FUNCTION immutable_search_text(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT regexp_replace(public.immutable_unaccent(lower($1)), '[^[:alnum:]]+', '', 'g') $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_admin_boundaries_name_trgm ON admin_boundaries USING gin (immutable_search_text(name) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_admin_boundaries_name_en_trgm ON admin_boundaries USING gin (immutable_search_text(coalesce(name_en, '')) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_admin_boundaries_names_trgm ON admin_boundaries USING gin (immutable_search_text(coalesce(names::text, '')) gin_trgm_ops);
