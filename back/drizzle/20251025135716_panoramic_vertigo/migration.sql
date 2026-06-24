CREATE TYPE "public"."change_request_status" AS ENUM('pending', 'approved', 'rejected', 'conflicted');--> statement-breakpoint
ALTER TABLE "change_requests" ADD COLUMN "status" "change_request_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "change_requests" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "change_requests" ADD COLUMN "resolved_by" uuid;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "idx_change_requests_status" ON "change_requests" USING btree ("status");