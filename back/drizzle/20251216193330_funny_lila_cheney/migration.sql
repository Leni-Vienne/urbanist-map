CREATE INDEX "idx_overlays_status" ON "overlays" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_overlays_author_id" ON "overlays" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "idx_projects_status" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_projects_owner_id" ON "projects" USING btree ("owner_id");