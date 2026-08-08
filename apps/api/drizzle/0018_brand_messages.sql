CREATE TABLE "brand_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"overline_ar" text,
	"overline_en" text,
	"headline_ar" text NOT NULL,
	"headline_en" text,
	"accent_ar" text,
	"accent_en" text,
	"body_ar" text,
	"body_en" text,
	"image_url" text,
	"image_alt_ar" text,
	"image_alt_en" text,
	"cta_label_ar" text,
	"cta_label_en" text,
	"cta_href" text,
	"starts_on" date,
	"ends_on" date,
	"city" varchar(40),
	"vertical" varchar(8),
	"priority" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_messages" ADD CONSTRAINT "brand_messages_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_messages_live_idx" ON "brand_messages" USING btree ("active","starts_on","ends_on");