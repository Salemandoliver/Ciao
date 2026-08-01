CREATE TABLE "partner_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(12) NOT NULL,
	"user_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"value" bigint NOT NULL,
	"status" varchar(12) DEFAULT 'issued' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"redeemed_by_user_id" uuid,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_ar" text NOT NULL,
	"category" varchar(24) NOT NULL,
	"venue_id" uuid,
	"city" varchar(40),
	"area" varchar(60),
	"contact_phone" varchar(20),
	"staff_user_id" uuid,
	"description_ar" text,
	"logo_url" text,
	"min_value" bigint DEFAULT 5000 NOT NULL,
	"max_value" bigint DEFAULT 100000 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(24) NOT NULL,
	"kind" varchar(10) NOT NULL,
	"value" integer NOT NULL,
	"description_ar" text,
	"vertical" varchar(8),
	"city" varchar(40),
	"listing_id" uuid,
	"min_spend" bigint DEFAULT 0 NOT NULL,
	"max_discount" bigint,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"max_redemptions" integer,
	"per_user_limit" integer DEFAULT 1 NOT NULL,
	"times_used" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promo_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"booking_id" uuid,
	"discount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "discount_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "promo_code" varchar(24);--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD COLUMN "expired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "partner_redemptions" ADD CONSTRAINT "partner_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_redemptions" ADD CONSTRAINT "partner_redemptions_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_redemptions" ADD CONSTRAINT "partner_redemptions_redeemed_by_user_id_users_id_fk" FOREIGN KEY ("redeemed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_id_promo_codes_id_fk" FOREIGN KEY ("promo_id") REFERENCES "public"."promo_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_redemption_code_uq" ON "partner_redemptions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "partner_redemption_user_idx" ON "partner_redemptions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "partner_redemption_partner_idx" ON "partner_redemptions" USING btree ("partner_id","status");--> statement-breakpoint
CREATE INDEX "partners_active_idx" ON "partners" USING btree ("active");--> statement-breakpoint
CREATE INDEX "partners_venue_idx" ON "partners" USING btree ("venue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_code_uq" ON "promo_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "promo_active_idx" ON "promo_codes" USING btree ("active");--> statement-breakpoint
CREATE INDEX "promo_redemption_promo_idx" ON "promo_redemptions" USING btree ("promo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_redemption_booking_uq" ON "promo_redemptions" USING btree ("promo_id","booking_id");--> statement-breakpoint
CREATE INDEX "loyalty_expiry_idx" ON "loyalty_ledger" USING btree ("expires_at");