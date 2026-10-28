-- Track indexes previously created by custom SQL or the boundary importer.
DROP INDEX "idx_users_email";--> statement-breakpoint
DROP INDEX "idx_import_sources_slug";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_admin_boundaries_geom" ON "admin_boundaries" USING gist ("geom");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_admin_boundaries_name_trgm" ON "admin_boundaries" USING gin (immutable_search_text("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_admin_boundaries_name_en_trgm" ON "admin_boundaries" USING gin (immutable_search_text(coalesce("name_en", '')) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_admin_boundaries_names_trgm" ON "admin_boundaries" USING gin (immutable_search_text(coalesce("names"::text, '')) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_overlays_corners" ON "overlays" USING gist ("corners");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_projects_center_coordinate" ON "projects" USING gist ("center_coordinate");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_projects_geometry" ON "projects" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_projects_geometry_100k" ON "projects" USING gist ("geometry") WHERE "geometry_size_m" >= 100000 AND "status" = 'approved';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_projects_geometry_50k" ON "projects" USING gist ("geometry") WHERE "geometry_size_m" >= 50000 AND "status" = 'approved';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_projects_geometry_10k" ON "projects" USING gist ("geometry") WHERE "geometry_size_m" >= 10000 AND "status" = 'approved';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_projects_tags" ON "projects" USING gin ("tags");
