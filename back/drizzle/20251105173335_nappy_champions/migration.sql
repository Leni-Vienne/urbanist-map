ALTER TYPE "public"."approval_status" ADD VALUE 'replaced';--> statement-breakpoint
CREATE TABLE "scheduled_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"overlay_id" uuid,
	"filename" text NOT NULL,
	"deletion_date" timestamp with time zone NOT NULL,
	"deletion_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "overlays" ADD COLUMN "replaced_by_overlay_id" uuid;--> statement-breakpoint
ALTER TABLE "scheduled_deletions" ADD CONSTRAINT "scheduled_deletions_overlay_id_overlays_id_fk" FOREIGN KEY ("overlay_id") REFERENCES "public"."overlays"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "idx_scheduled_deletions_date" ON "scheduled_deletions" USING btree ("deletion_date");--> statement-breakpoint
CREATE INDEX "idx_scheduled_deletions_overlay" ON "scheduled_deletions" USING btree ("overlay_id");--> statement-breakpoint
CREATE INDEX "idx_overlays_replaces" ON "overlays" USING btree ("replaces_overlay_id");