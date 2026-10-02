CREATE TABLE "carrier_rates" (
	"carrier_id" integer NOT NULL,
	"wilaya_code" integer NOT NULL,
	"home_fee" integer,
	"desk_fee" integer,
	CONSTRAINT "carrier_rates_carrier_id_wilaya_code_pk" PRIMARY KEY("carrier_id","wilaya_code")
);
--> statement-breakpoint
CREATE TABLE "carriers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"api_enabled" boolean DEFAULT false NOT NULL,
	"credentials" text DEFAULT '' NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"blacklisted" boolean DEFAULT false NOT NULL,
	"blacklist_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "export_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"carrier_id" integer,
	"created_by_id" integer,
	"order_ids" jsonb NOT NULL,
	"order_count" integer NOT NULL,
	"total_amount" integer NOT NULL,
	"headers" jsonb NOT NULL,
	"rows" jsonb NOT NULL,
	"file_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"name" text NOT NULL,
	"carrier_name" text NOT NULL,
	"units" integer DEFAULT 1 NOT NULL,
	"price" integer NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"author_id" integer,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"actor_id" integer,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" integer NOT NULL,
	"variant_id" integer,
	"size" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" serial NOT NULL,
	"lead_id" text,
	"source_id" integer,
	"sheet_name" text,
	"sheet_row" integer,
	"status" text DEFAULT 'new' NOT NULL,
	"customer_id" integer,
	"customer_name" text DEFAULT '' NOT NULL,
	"phone" text,
	"phone_customer" text,
	"phone_facebook" text,
	"phone_alt" text,
	"phone_issue" text,
	"duplicate_of_id" uuid,
	"wilaya_code" integer,
	"wilaya_raw" text,
	"commune_name" text,
	"commune_raw" text,
	"address" text,
	"delivery_type" text DEFAULT 'home' NOT NULL,
	"stopdesk_id" text,
	"offer_id" integer,
	"offer_raw" text,
	"price" integer DEFAULT 0 NOT NULL,
	"size" text,
	"colors" text,
	"assigned_to_id" integer,
	"call_attempts" integer DEFAULT 0 NOT NULL,
	"next_call_at" timestamp with time zone,
	"locked_by_id" integer,
	"locked_until" timestamp with time zone,
	"confirmed_by_id" integer,
	"confirmed_at" timestamp with time zone,
	"cancel_reason" text,
	"carrier_id" integer,
	"export_batch_id" integer,
	"carrier_tracking" text,
	"carrier_status" text,
	"stock_out" boolean DEFAULT false NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"last_comment" text,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_number_unique" UNIQUE("number"),
	CONSTRAINT "orders_lead_id_unique" UNIQUE("lead_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"sizes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"colors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cost_price" integer DEFAULT 0 NOT NULL,
	"low_stock_alert" integer DEFAULT 3 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'google_sheet' NOT NULL,
	"spreadsheet_id" text DEFAULT '' NOT NULL,
	"form_type" text DEFAULT 'new' NOT NULL,
	"offer_id" integer,
	"sheet_names" jsonb DEFAULT '["Sheet1","Sheet2"]'::jsonb NOT NULL,
	"import_from" text NOT NULL,
	"field_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"token" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_sync_stats" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"variant_id" integer NOT NULL,
	"type" text NOT NULL,
	"quantity" integer NOT NULL,
	"note" text,
	"order_id" uuid,
	"actor_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"size" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "carrier_rates" ADD CONSTRAINT "carrier_rates_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_batches" ADD CONSTRAINT "export_batches_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_batches" ADD CONSTRAINT "export_batches_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_comments" ADD CONSTRAINT "order_comments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_comments" ADD CONSTRAINT "order_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_duplicate_of_id_orders_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_locked_by_id_users_id_fk" FOREIGN KEY ("locked_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_confirmed_by_id_users_id_fk" FOREIGN KEY ("confirmed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_export_batch_id_export_batches_id_fk" FOREIGN KEY ("export_batch_id") REFERENCES "public"."export_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_comments_order_idx" ON "order_comments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_variant_idx" ON "order_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_created_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "orders_offer_idx" ON "orders" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "orders_wilaya_idx" ON "orders" USING btree ("wilaya_code");--> statement-breakpoint
CREATE INDEX "orders_assigned_idx" ON "orders" USING btree ("assigned_to_id");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_phone_idx" ON "orders" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "orders_tracking_idx" ON "orders" USING btree ("carrier_tracking");--> statement-breakpoint
CREATE INDEX "orders_queue_idx" ON "orders" USING btree ("next_call_at") WHERE "orders"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "stock_movements_variant_idx" ON "stock_movements" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "stock_movements_order_idx" ON "stock_movements" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "variants_option_idx" ON "variants" USING btree ("product_id","size","color");