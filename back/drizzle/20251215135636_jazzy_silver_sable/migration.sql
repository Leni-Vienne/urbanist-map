ALTER TABLE "cities" ADD COLUMN "approved_project_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_cities_name" ON "cities" USING btree ("name");