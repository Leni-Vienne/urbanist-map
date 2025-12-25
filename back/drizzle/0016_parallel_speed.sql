ALTER TABLE "overlays" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;