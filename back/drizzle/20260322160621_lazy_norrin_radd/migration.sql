ALTER TABLE "projects" ALTER COLUMN "name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "country_code" char(3);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "detached_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint