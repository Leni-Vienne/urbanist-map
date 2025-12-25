CREATE TABLE "config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"info_message" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
