ALTER TABLE "order_items" ADD COLUMN "return_condition" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "related_order_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_related_order_id_orders_id_fk" FOREIGN KEY ("related_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;