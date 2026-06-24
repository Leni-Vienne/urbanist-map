CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TABLE "overlays" ADD COLUMN "status" "approval_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "status" "approval_status" DEFAULT 'pending' NOT NULL;