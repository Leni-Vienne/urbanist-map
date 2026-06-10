ALTER TABLE "overlays" ALTER COLUMN "corners" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "overlays" ALTER COLUMN "centroid" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "overlays" ADD COLUMN "kind" text DEFAULT 'map' NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_overlays_kind" ON "overlays" USING btree ("kind");