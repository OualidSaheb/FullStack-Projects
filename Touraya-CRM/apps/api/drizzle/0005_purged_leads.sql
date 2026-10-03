CREATE TABLE "purged_leads" (
	"lead_id" text PRIMARY KEY NOT NULL,
	"purged_at" timestamp with time zone DEFAULT now() NOT NULL
);
