CREATE TABLE "cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"country_code" char(3) NOT NULL,
	"coordinates" geometry(point) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" char(3) NOT NULL,
	"name" text NOT NULL,
	"center_coordinates" geometry(point) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "countries_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "city_id" uuid;--> statement-breakpoint
CREATE INDEX "idx_cities_country" ON "cities" USING btree ("country_code");--> statement-breakpoint
CREATE INDEX "idx_countries_code" ON "countries" USING btree ("code");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;