ALTER TABLE "overlays" DROP CONSTRAINT "overlays_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "overlays" DROP CONSTRAINT "overlays_author_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "projects_owner_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "projects_city_id_cities_id_fk";
--> statement-breakpoint
ALTER TABLE "overlays" ADD CONSTRAINT "overlays_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "overlays" ADD CONSTRAINT "overlays_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE set null ON UPDATE cascade;