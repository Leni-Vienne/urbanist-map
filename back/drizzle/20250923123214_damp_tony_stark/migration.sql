ALTER TABLE "projects" ADD COLUMN "is_marker" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "coordinates" geometry(point);