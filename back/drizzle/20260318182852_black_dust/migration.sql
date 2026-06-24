CREATE TABLE "import_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"url_template" text,
	"attribution" text,
	"last_sync_at" timestamp with time zone,
	"last_sync_started_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_sources_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "city_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "timeline_status" text DEFAULT 'proposed' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "import_source_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "external_properties" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "external_last_modified" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "last_imported_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_import_sources_slug" ON "import_sources" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_import_sources_type" ON "import_sources" USING btree ("type");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_import_source_id_import_sources_id_fk" FOREIGN KEY ("import_source_id") REFERENCES "public"."import_sources"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "idx_projects_timeline_status" ON "projects" USING btree ("timeline_status");--> statement-breakpoint
CREATE INDEX "idx_projects_import_source" ON "projects" USING btree ("import_source_id");--> statement-breakpoint
CREATE INDEX "idx_projects_external_id" ON "projects" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "idx_projects_last_imported" ON "projects" USING btree ("last_imported_at");--> statement-breakpoint
CREATE INDEX "idx_projects_external_last_modified" ON "projects" USING btree ("external_last_modified");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_projects_source_external" ON "projects" ("import_source_id", "external_id");