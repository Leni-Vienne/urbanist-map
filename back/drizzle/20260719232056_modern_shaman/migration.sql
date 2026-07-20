CREATE TABLE "uploaded_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"filename" text NOT NULL,
	"original_filename" text,
	"uploader_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_uploaded_files_filename" ON "uploaded_files" ("filename");--> statement-breakpoint
CREATE INDEX "idx_uploaded_files_uploader" ON "uploaded_files" ("uploader_id");--> statement-breakpoint
CREATE INDEX "idx_uploaded_files_created_at" ON "uploaded_files" ("created_at");--> statement-breakpoint
ALTER TABLE "uploaded_files" ADD CONSTRAINT "uploaded_files_uploader_id_users_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
-- Attribute already-staged pending images, which would otherwise stop counting toward their
-- uploader's storage quota. The original's extension is not recoverable from the overlay row, so
-- pre-existing originals go untracked and are charged from the next upload onward.
INSERT INTO "uploaded_files" ("filename", "uploader_id", "created_at")
SELECT "filename", "author_id", "created_at"
FROM "overlays"
WHERE "status" = 'pending' AND "author_id" IS NOT NULL
ON CONFLICT DO NOTHING;
