ALTER TABLE "projects" ADD COLUMN "tags" text[];
CREATE INDEX IF NOT EXISTS idx_projects_tags ON projects USING GIN (tags);