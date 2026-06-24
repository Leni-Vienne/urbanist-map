CREATE TABLE "deleted_projects" (
	"slug" text PRIMARY KEY,
	"lat" double precision,
	"lng" double precision,
	"status" text DEFAULT 'removed' NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "indexable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_deleted_projects_deleted_at" ON "deleted_projects" ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_projects_indexable" ON "projects" ("slug") WHERE "indexable" = true;