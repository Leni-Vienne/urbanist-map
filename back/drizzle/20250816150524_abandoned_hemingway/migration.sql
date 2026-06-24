CREATE TABLE "change_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_request_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"field_name" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb NOT NULL,
	"changed_by" uuid,
	"approved_by" uuid,
	"applied_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"field_name" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb NOT NULL,
	"change_reason" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "change_history" ADD CONSTRAINT "change_history_change_request_id_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."change_requests"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "change_history" ADD CONSTRAINT "change_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "change_history" ADD CONSTRAINT "change_history_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "idx_change_history_entity" ON "change_history" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_change_history_request" ON "change_history" USING btree ("change_request_id");--> statement-breakpoint
CREATE INDEX "idx_change_requests_entity" ON "change_requests" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_change_requests_requested_by" ON "change_requests" USING btree ("requested_by");