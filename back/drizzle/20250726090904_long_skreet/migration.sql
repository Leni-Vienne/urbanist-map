ALTER TABLE "users" ADD CONSTRAINT "users_username_unique" UNIQUE("username");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");