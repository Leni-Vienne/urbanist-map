ALTER TABLE "images" RENAME TO "overlays";--> statement-breakpoint
ALTER TABLE "overlays" DROP CONSTRAINT "images_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "overlays" DROP CONSTRAINT "images_author_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "idx_images_project";--> statement-breakpoint
ALTER TABLE "overlays" ADD CONSTRAINT "overlays_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overlays" ADD CONSTRAINT "overlays_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_overlays_project" ON "overlays" USING btree ("project_id");