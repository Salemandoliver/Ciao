CREATE TABLE "partner_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"service_id" uuid,
	"name_ar" text NOT NULL,
	"name_en" text,
	"description_ar" text,
	"price" bigint DEFAULT 0 NOT NULL,
	"price_model" varchar(10) DEFAULT 'flat' NOT NULL,
	"max_qty" integer DEFAULT 1 NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"job_id" uuid,
	"day" date NOT NULL,
	"label_ar" text NOT NULL,
	"category" varchar(12) DEFAULT 'other' NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"recurring" varchar(8),
	"recurring_until" date,
	"notes_ar" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_intake_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"service_id" uuid,
	"prompt_ar" text NOT NULL,
	"prompt_en" text,
	"help_ar" text,
	"field_type" varchar(8) DEFAULT 'text' NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_price_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"service_id" uuid,
	"label_ar" text NOT NULL,
	"kind" varchar(10) NOT NULL,
	"from_day" date,
	"to_day" date,
	"weekdays" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"min_lead_days" integer,
	"max_lead_days" integer,
	"min_units" integer,
	"adjust_bps" integer DEFAULT 10000 NOT NULL,
	"adjust_flat" bigint DEFAULT 0 NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"code" varchar(24),
	"label_ar" text NOT NULL,
	"label_en" text,
	"kind" varchar(10) DEFAULT 'percent' NOT NULL,
	"value_bps" integer DEFAULT 0 NOT NULL,
	"value_flat" bigint DEFAULT 0 NOT NULL,
	"free_addon_id" uuid,
	"max_discount" bigint,
	"min_spend" bigint DEFAULT 0 NOT NULL,
	"service_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"from_day" date,
	"to_day" date,
	"travel_from_day" date,
	"travel_to_day" date,
	"max_redemptions" integer DEFAULT 0 NOT NULL,
	"max_per_client" integer DEFAULT 0 NOT NULL,
	"redemptions" integer DEFAULT 0 NOT NULL,
	"first_time_only" boolean DEFAULT false NOT NULL,
	"public_on_listing" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"listing_id" uuid,
	"name_ar" text NOT NULL,
	"name_en" text,
	"description_ar" text,
	"description_en" text,
	"unit" varchar(8) DEFAULT 'item' NOT NULL,
	"base_price" bigint DEFAULT 0 NOT NULL,
	"min_units" integer DEFAULT 1 NOT NULL,
	"max_units" integer,
	"duration_minutes" integer,
	"min_guests" integer,
	"max_guests" integer,
	"notice_hours" integer,
	"deposit_bps" integer,
	"cancellation_tier" varchar(12),
	"daily_capacity" integer,
	"includes_ar" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"media" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"instant_book" boolean DEFAULT false NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"booked_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_intents" ALTER COLUMN "booking_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "partner_service_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "addons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "intake_answers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "partner_promotion_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "partner_discount_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_jobs" ADD COLUMN "service_id" uuid;--> statement-breakpoint
ALTER TABLE "partner_jobs" ADD COLUMN "units" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_jobs" ADD COLUMN "guest_count" integer;--> statement-breakpoint
ALTER TABLE "partner_jobs" ADD COLUMN "addons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_jobs" ADD COLUMN "intake_answers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_jobs" ADD COLUMN "promotion_id" uuid;--> statement-breakpoint
ALTER TABLE "partner_jobs" ADD COLUMN "discount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_jobs" ADD COLUMN "assigned_to" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_subscriptions" ADD COLUMN "term" varchar(8) DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_subscriptions" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
ALTER TABLE "partner_subscriptions" ADD COLUMN "renewal_notices_sent" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_subscriptions" ADD COLUMN "renewal_reminders_off" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN "subject_id" uuid;--> statement-breakpoint
ALTER TABLE "partner_addons" ADD CONSTRAINT "partner_addons_partner_id_users_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_addons" ADD CONSTRAINT "partner_addons_service_id_partner_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."partner_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_expenses" ADD CONSTRAINT "partner_expenses_partner_id_users_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_expenses" ADD CONSTRAINT "partner_expenses_job_id_partner_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."partner_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_expenses" ADD CONSTRAINT "partner_expenses_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_intake_questions" ADD CONSTRAINT "partner_intake_questions_partner_id_users_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_intake_questions" ADD CONSTRAINT "partner_intake_questions_service_id_partner_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."partner_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_price_rules" ADD CONSTRAINT "partner_price_rules_partner_id_users_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_price_rules" ADD CONSTRAINT "partner_price_rules_service_id_partner_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."partner_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_promotions" ADD CONSTRAINT "partner_promotions_partner_id_users_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_promotions" ADD CONSTRAINT "partner_promotions_free_addon_id_partner_addons_id_fk" FOREIGN KEY ("free_addon_id") REFERENCES "public"."partner_addons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_services" ADD CONSTRAINT "partner_services_partner_id_users_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_services" ADD CONSTRAINT "partner_services_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_addons_partner_idx" ON "partner_addons" USING btree ("partner_id","active","sort_order");--> statement-breakpoint
CREATE INDEX "partner_expenses_partner_idx" ON "partner_expenses" USING btree ("partner_id","day");--> statement-breakpoint
CREATE INDEX "partner_intake_partner_idx" ON "partner_intake_questions" USING btree ("partner_id","active","sort_order");--> statement-breakpoint
CREATE INDEX "partner_price_rules_partner_idx" ON "partner_price_rules" USING btree ("partner_id","active","priority");--> statement-breakpoint
CREATE INDEX "partner_promotions_partner_idx" ON "partner_promotions" USING btree ("partner_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_promotions_code_uq" ON "partner_promotions" USING btree ("partner_id","code");--> statement-breakpoint
CREATE INDEX "partner_services_partner_idx" ON "partner_services" USING btree ("partner_id","active","sort_order");--> statement-breakpoint
CREATE INDEX "partner_services_listing_idx" ON "partner_services" USING btree ("listing_id","published");