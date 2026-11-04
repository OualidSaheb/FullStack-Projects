CREATE TABLE "ad_spend" (
	"id" serial PRIMARY KEY NOT NULL,
	"day" text NOT NULL,
	"amount_usd" double precision NOT NULL,
	"usd_rate" double precision NOT NULL,
	"offer_id" integer,
	"note" text,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_spend" ADD CONSTRAINT "ad_spend_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_spend" ADD CONSTRAINT "ad_spend_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_spend_day_idx" ON "ad_spend" USING btree ("day");