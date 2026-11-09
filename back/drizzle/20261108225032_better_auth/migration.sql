CREATE TABLE "auth_verifications" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "idx_users_email_verification";--> statement-breakpoint
DROP INDEX "idx_users_password_reset";--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD COLUMN "password" text;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD COLUMN "access_token" text;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD COLUMN "refresh_token" text;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD COLUMN "id_token" text;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD COLUMN "access_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD COLUMN "refresh_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD COLUMN "scope" text;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Old middleware sessions cannot be interpreted by Better Auth. Users sign in again.
DELETE FROM "sessions";--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "token" text NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "ip_address" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "data";--> statement-breakpoint
-- Preserve existing credentials verbatim; the configured Bun verifier reads these hashes.
INSERT INTO "oauth_accounts" ("id", "user_id", "provider", "provider_account_id", "password", "created_at", "updated_at")
SELECT gen_random_uuid(), "id", 'credential', "id"::text, "password_hash", "created_at", "updated_at"
FROM "users" WHERE "password_hash" IS NOT NULL;--> statement-breakpoint
-- Better Auth normalizes email addresses. A conflicting legacy pair aborts the migration.
UPDATE "users" SET "email" = lower("email");--> statement-breakpoint
UPDATE "users" SET "username" = 'User ' || "id"::text WHERE "username" IS NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_hash";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "email_verification_token";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_reset_token";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_reset_expires_at";--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_token_key" UNIQUE("token");--> statement-breakpoint
CREATE INDEX "idx_auth_verifications_identifier" ON "auth_verifications" ("identifier");--> statement-breakpoint
CREATE INDEX "idx_sessions_user_id" ON "sessions" ("user_id");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;