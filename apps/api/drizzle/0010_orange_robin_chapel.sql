CREATE TABLE "partner_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"name_ar" text NOT NULL,
	"phone" varchar(20),
	"ciao_user_id" uuid,
	"notes_ar" text,
	"jobs_count" integer DEFAULT 0 NOT NULL,
	"total_spend" bigint DEFAULT 0 NOT NULL,
	"last_job_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"listing_id" uuid,
	"booking_id" uuid,
	"client_id" uuid,
	"source" varchar(12) DEFAULT 'direct' NOT NULL,
	"kind" varchar(12) DEFAULT 'event' NOT NULL,
	"title_ar" text NOT NULL,
	"day" date NOT NULL,
	"end_day" date,
	"session" varchar(16) DEFAULT 'night' NOT NULL,
	"start_time" varchar(5),
	"end_time" varchar(5),
	"status" varchar(12) DEFAULT 'confirmed' NOT NULL,
	"price" bigint DEFAULT 0 NOT NULL,
	"amount_paid" bigint DEFAULT 0 NOT NULL,
	"location_ar" text,
	"notes_ar" text,
	"blocks_calendar" boolean DEFAULT true NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_payout_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"rail" varchar(12) DEFAULT 'bank_app' NOT NULL,
	"label" text,
	"account_ref" text NOT NULL,
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"activates_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"requested_by_id" uuid,
	"requested_ip" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"business_name_ar" text,
	"business_name_en" text,
	"kind" varchar(8) DEFAULT 'venue' NOT NULL,
	"working_days" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"working_hours" jsonb,
	"notice_hours" integer DEFAULT 0 NOT NULL,
	"max_jobs_per_day" integer DEFAULT 1 NOT NULL,
	"travels_to_client" boolean DEFAULT false NOT NULL,
	"travel_fee" bigint DEFAULT 0 NOT NULL,
	"service_areas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_deposit_bps" integer DEFAULT 2000 NOT NULL,
	"agenda_enabled" boolean DEFAULT true NOT NULL,
	"agenda_hour" integer DEFAULT 18 NOT NULL,
	"locale" varchar(5) DEFAULT 'ar' NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(12) NOT NULL,
	"partner_id" uuid NOT NULL,
	"client_id" uuid,
	"listing_id" uuid,
	"title_ar" text NOT NULL,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal" bigint DEFAULT 0 NOT NULL,
	"discount" bigint DEFAULT 0 NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"deposit_amount" bigint DEFAULT 0 NOT NULL,
	"proposed_day" date,
	"session" varchar(16),
	"start_time" varchar(5),
	"valid_until" date,
	"notes_ar" text,
	"terms_ar" text,
	"status" varchar(10) DEFAULT 'draft' NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"job_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_subscriptions" (
	"partner_id" uuid PRIMARY KEY NOT NULL,
	"plan" varchar(8) DEFAULT 'free' NOT NULL,
	"status" varchar(10) DEFAULT 'none' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"price_dirhams" bigint DEFAULT 0 NOT NULL,
	"settlement" varchar(16) DEFAULT 'payout_netting' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"member_user_id" uuid NOT NULL,
	"role" varchar(8) DEFAULT 'staff' NOT NULL,
	"invited_by_id" uuid,
	"disabled_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partner_clients" ADD CONSTRAINT "partner_clients_partner_id_users_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_clients" ADD CONSTRAINT "partner_clients_ciao_user_id_users_id_fk" FOREIGN KEY ("ciao_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_jobs" ADD CONSTRAINT "partner_jobs_partner_id_users_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_jobs" ADD CONSTRAINT "partner_jobs_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_jobs" ADD CONSTRAINT "partner_jobs_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_jobs" ADD CONSTRAINT "partner_jobs_client_id_partner_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."partner_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_jobs" ADD CONSTRAINT "partner_jobs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_accounts" ADD CONSTRAINT "partner_payout_accounts_partner_id_users_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_accounts" ADD CONSTRAINT "partner_payout_accounts_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_profiles" ADD CONSTRAINT "partner_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_quotes" ADD CONSTRAINT "partner_quotes_partner_id_users_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_quotes" ADD CONSTRAINT "partner_quotes_client_id_partner_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."partner_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_quotes" ADD CONSTRAINT "partner_quotes_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_quotes" ADD CONSTRAINT "partner_quotes_job_id_partner_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."partner_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_quotes" ADD CONSTRAINT "partner_quotes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_subscriptions" ADD CONSTRAINT "partner_subscriptions_partner_id_users_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_team" ADD CONSTRAINT "partner_team_partner_id_users_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_team" ADD CONSTRAINT "partner_team_member_user_id_users_id_fk" FOREIGN KEY ("member_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_team" ADD CONSTRAINT "partner_team_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_clients_partner_idx" ON "partner_clients" USING btree ("partner_id","last_job_at");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_clients_phone_uq" ON "partner_clients" USING btree ("partner_id","phone");--> statement-breakpoint
CREATE INDEX "partner_jobs_partner_day_idx" ON "partner_jobs" USING btree ("partner_id","day");--> statement-breakpoint
CREATE INDEX "partner_jobs_client_idx" ON "partner_jobs" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_jobs_booking_uq" ON "partner_jobs" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "partner_payout_accounts_partner_idx" ON "partner_payout_accounts" USING btree ("partner_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_quotes_code_uq" ON "partner_quotes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "partner_quotes_partner_idx" ON "partner_quotes" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_team_uq" ON "partner_team" USING btree ("partner_id","member_user_id");--> statement-breakpoint
CREATE INDEX "partner_team_member_idx" ON "partner_team" USING btree ("member_user_id");