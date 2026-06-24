CREATE TABLE "user_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reported_user_id" uuid NOT NULL,
	"reported_by" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "approved_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "rejected_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_reported_user_id_users_id_fk" FOREIGN KEY ("reported_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "idx_user_reports_reported_user" ON "user_reports" USING btree ("reported_user_id");--> statement-breakpoint
CREATE INDEX "idx_user_reports_reported_by" ON "user_reports" USING btree ("reported_by");