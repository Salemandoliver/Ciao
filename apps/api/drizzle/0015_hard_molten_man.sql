CREATE TABLE "listing_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"nightly" bigint NOT NULL,
	"flat" boolean DEFAULT false NOT NULL,
	"min_nights" integer,
	"label_ar" text,
	"label_en" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"user_id" uuid,
	"phone" varchar(20) NOT NULL,
	"check_in" date,
	"check_out" date,
	"guests" integer,
	"status" varchar(12) DEFAULT 'waiting' NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "included_guests" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "extra_bed_price" bigint;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "min_nights" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "board_basis" varchar(12) DEFAULT 'room_only' NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "child_free_under" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "child_reduced_under" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "child_reduced_bps" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "check_in_time" varchar(5);--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "check_out_time" varchar(5);--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "unit_kind" varchar(12);--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "bathrooms" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "house_rules_en" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "requirements" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD COLUMN "venue_id" uuid;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD COLUMN "funded_by" varchar(8) DEFAULT 'ciao' NOT NULL;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD COLUMN "created_by_partner_id" uuid;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "slug" varchar(80);--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "office_hours" jsonb;--> statement-breakpoint
ALTER TABLE "listing_rates" ADD CONSTRAINT "listing_rates_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_rates" ADD CONSTRAINT "listing_rates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listing_rates_listing_idx" ON "listing_rates" USING btree ("listing_id","start_date");--> statement-breakpoint
CREATE INDEX "waitlist_listing_idx" ON "waitlist" USING btree ("listing_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_person_uq" ON "waitlist" USING btree ("listing_id","phone","check_in");--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_created_by_partner_id_users_id_fk" FOREIGN KEY ("created_by_partner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "promo_venue_idx" ON "promo_codes" USING btree ("venue_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "venues_slug_uq" ON "venues" USING btree ("slug");