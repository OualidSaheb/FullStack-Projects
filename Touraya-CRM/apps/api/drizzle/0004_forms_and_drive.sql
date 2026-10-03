CREATE TABLE "forms" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"source_id" integer,
	"spreadsheet_id" text DEFAULT '' NOT NULL,
	"spreadsheet_name" text DEFAULT '' NOT NULL,
	"sheet_name" text DEFAULT '' NOT NULL,
	"offer_id" integer,
	"linked_by" text,
	"field_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_lead_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forms_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "form_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ad_name" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "folder_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "files" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_form_idx" ON "orders" USING btree ("form_id");