CREATE TABLE "action_tokens" (
	"jti" uuid PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" varchar(30),
	"target_id" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"from_state" varchar(24),
	"to_state" varchar(24) NOT NULL,
	"actor" varchar(12) NOT NULL,
	"actor_id" uuid,
	"reason" text,
	"payload" jsonb,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(12) NOT NULL,
	"listing_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"host_id" uuid,
	"type" varchar(12) NOT NULL,
	"state" varchar(24) DEFAULT 'draft' NOT NULL,
	"check_in" date,
	"check_out" date,
	"session" varchar(16) DEFAULT 'night' NOT NULL,
	"package_id" uuid,
	"guest_count" integer,
	"total_amount" bigint DEFAULT 0 NOT NULL,
	"deposit_amount" bigint DEFAULT 0 NOT NULL,
	"balance_on_arrival" bigint DEFAULT 0 NOT NULL,
	"commission_amount" bigint DEFAULT 0 NOT NULL,
	"cancellation_tier" varchar(10) DEFAULT 'moderate' NOT NULL,
	"confirmation_deadline" timestamp with time zone,
	"contact_revealed" boolean DEFAULT false NOT NULL,
	"voucher_issued_at" timestamp with time zone,
	"checked_in_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"concierge" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_days" (
	"listing_id" uuid NOT NULL,
	"day" date NOT NULL,
	"session" varchar(16) DEFAULT 'night' NOT NULL,
	"state" varchar(8) DEFAULT 'open' NOT NULL,
	"price_override" bigint,
	"booking_id" uuid,
	"hold_expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_days_listing_id_day_session_pk" PRIMARY KEY("listing_id","day","session")
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"opened_by_id" uuid NOT NULL,
	"category" varchar(30) NOT NULL,
	"statement" text,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(12) DEFAULT 'open' NOT NULL,
	"resolution" text,
	"remedy" varchar(30),
	"due_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"ask_amount" bigint NOT NULL,
	"hall_approval" varchar(12) DEFAULT 'pending' NOT NULL,
	"status" varchar(12) DEFAULT 'listed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tx_id" uuid NOT NULL,
	"account" text NOT NULL,
	"booking_id" uuid,
	"debit" bigint DEFAULT 0 NOT NULL,
	"credit" bigint DEFAULT 0 NOT NULL,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"slug" varchar(80) NOT NULL,
	"status" varchar(12) DEFAULT 'draft' NOT NULL,
	"title_ar" text NOT NULL,
	"title_en" text,
	"description_ar" text,
	"description_en" text,
	"booking_types" jsonb DEFAULT '["stay"]'::jsonb NOT NULL,
	"base_nightly" bigint DEFAULT 0 NOT NULL,
	"weekend_multiplier_bps" integer DEFAULT 12500 NOT NULL,
	"thursday_multiplier_bps" integer DEFAULT 11500 NOT NULL,
	"season_multiplier_bps" integer DEFAULT 10000 NOT NULL,
	"day_use_price" bigint,
	"extra_guest_fee" bigint,
	"max_guests" integer,
	"bedrooms" integer,
	"cancellation_tier" varchar(10) DEFAULT 'moderate' NOT NULL,
	"house_rules_ar" text,
	"media" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"family_only" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logged_cash_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_no" varchar(20) NOT NULL,
	"booking_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"purpose" varchar(20) NOT NULL,
	"host_confirmed_at" timestamp with time zone,
	"guest_confirmed_at" timestamp with time zone,
	"mismatch_ticket_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid,
	"kind" varchar(10) NOT NULL,
	"template_key" text,
	"channel" varchar(10),
	"from_user_id" uuid,
	"to_user_id" uuid,
	"to_phone" varchar(20),
	"body" text NOT NULL,
	"masked_body" text,
	"delivery_status" varchar(12) DEFAULT 'queued' NOT NULL,
	"ladder_step" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" varchar(20) NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"channel" varchar(10) DEFAULT 'sms' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"name_ar" text NOT NULL,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_price" bigint NOT NULL,
	"guest_count_max" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"purpose" varchar(20) DEFAULT 'deposit' NOT NULL,
	"amount" bigint NOT NULL,
	"rail" varchar(12) NOT NULL,
	"provider" varchar(12) NOT NULL,
	"provider_ref" text,
	"invoice_no" varchar(40) NOT NULL,
	"status" varchar(16) DEFAULT 'created' NOT NULL,
	"failure_code" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"rail" varchar(12) NOT NULL,
	"provider" varchar(12) NOT NULL,
	"provider_ref" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"booking_id" uuid,
	"amount" bigint NOT NULL,
	"rail" varchar(12) DEFAULT 'bank_app' NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"release_after" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rail_health" (
	"rail" varchar(12) PRIMARY KEY NOT NULL,
	"healthy" boolean DEFAULT true NOT NULL,
	"last_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_failure_at" timestamp with time zone,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"payment_id" uuid,
	"amount" bigint NOT NULL,
	"method" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"bonus_credit" bigint DEFAULT 0 NOT NULL,
	"sla_due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reliability_scores" (
	"host_id" uuid PRIMARY KEY NOT NULL,
	"score" integer DEFAULT 50 NOT NULL,
	"confirmation_rate_bps" integer DEFAULT 10000 NOT NULL,
	"median_response_minutes" integer DEFAULT 0 NOT NULL,
	"attestation_streak_weeks" integer DEFAULT 0 NOT NULL,
	"double_booking_incidents" integer DEFAULT 0 NOT NULL,
	"cancellation_strikes" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"author_role" varchar(6) NOT NULL,
	"author_id" uuid NOT NULL,
	"scores" jsonb NOT NULL,
	"text" text,
	"published_at" timestamp with time zone,
	"host_reply" text,
	"moderated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(40) NOT NULL,
	"ref_id" uuid,
	"run_at" timestamp with time zone NOT NULL,
	"payload" jsonb,
	"locked_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exchange_listing_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"fee_amount" bigint NOT NULL,
	"new_booking_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" varchar(20) NOT NULL,
	"role" varchar(10) DEFAULT 'guest' NOT NULL,
	"display_name" text,
	"public_name" text,
	"locale" varchar(5) DEFAULT 'ar' NOT NULL,
	"email" text,
	"no_show_count" integer DEFAULT 0 NOT NULL,
	"completed_stays" integer DEFAULT 0 NOT NULL,
	"credit_balance" bigint DEFAULT 0 NOT NULL,
	"id_document_ref" text,
	"disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(8) NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text,
	"city" varchar(40) NOT NULL,
	"area" varchar(60),
	"host_id" uuid,
	"approx_lat" text,
	"approx_lng" text,
	"exact_lat" text,
	"exact_lng" text,
	"address_ar" text,
	"verification_grade" varchar(30) DEFAULT 'unverified' NOT NULL,
	"verified_at" timestamp with time zone,
	"verification_expires_at" timestamp with time zone,
	"badge_revoked" boolean DEFAULT false NOT NULL,
	"amenities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"privacy" jsonb,
	"capacity_womens" integer,
	"capacity_mens" integer,
	"founding_host" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"visit_date" date NOT NULL,
	"gps_lat" text,
	"gps_lng" text,
	"checklist" jsonb NOT NULL,
	"evidence_media" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"identity_evidence_grade" varchar(30) NOT NULL,
	"contract_ref" text,
	"outcome" varchar(12) DEFAULT 'pending' NOT NULL,
	"synced_from_offline" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(12) NOT NULL,
	"external_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"signature_valid" boolean NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_tokens" ADD CONSTRAINT "action_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_guest_id_users_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_days" ADD CONSTRAINT "calendar_days_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_opened_by_id_users_id_fk" FOREIGN KEY ("opened_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_listings" ADD CONSTRAINT "exchange_listings_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_listings" ADD CONSTRAINT "exchange_listings_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logged_cash_receipts" ADD CONSTRAINT "logged_cash_receipts_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reliability_scores" ADD CONSTRAINT "reliability_scores_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_exchange_listing_id_exchange_listings_id_fk" FOREIGN KEY ("exchange_listing_id") REFERENCES "public"."exchange_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_new_booking_id_bookings_id_fk" FOREIGN KEY ("new_booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_events_seq_uq" ON "booking_events" USING btree ("booking_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_events_idem_uq" ON "booking_events" USING btree ("booking_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_code_uq" ON "bookings" USING btree ("code");--> statement-breakpoint
CREATE INDEX "bookings_guest_idx" ON "bookings" USING btree ("guest_id");--> statement-breakpoint
CREATE INDEX "bookings_host_idx" ON "bookings" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "bookings_state_idx" ON "bookings" USING btree ("state");--> statement-breakpoint
CREATE INDEX "bookings_listing_dates_idx" ON "bookings" USING btree ("listing_id","check_in");--> statement-breakpoint
CREATE INDEX "calendar_booking_idx" ON "calendar_days" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "disputes_status_idx" ON "disputes" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_booking_uq" ON "exchange_listings" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "ledger_tx_idx" ON "ledger_entries" USING btree ("tx_id");--> statement-breakpoint
CREATE INDEX "ledger_account_idx" ON "ledger_entries" USING btree ("account");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_slug_uq" ON "listings" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "listings_venue_idx" ON "listings" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "listings_status_idx" ON "listings" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_receipt_no_uq" ON "logged_cash_receipts" USING btree ("receipt_no");--> statement-breakpoint
CREATE INDEX "messages_booking_idx" ON "messages" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "otp_phone_idx" ON "otp_challenges" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "packages_listing_idx" ON "packages" USING btree ("listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pi_invoice_uq" ON "payment_intents" USING btree ("invoice_no");--> statement-breakpoint
CREATE INDEX "pi_booking_idx" ON "payment_intents" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "payments_booking_idx" ON "payments" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "payouts_host_idx" ON "payouts" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "payouts_status_idx" ON "payouts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "refresh_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refunds_booking_idx" ON "refunds" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_booking_author_uq" ON "reviews" USING btree ("booking_id","author_role");--> statement-breakpoint
CREATE INDEX "reviews_listing_idx" ON "reviews" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "scheduled_jobs" USING btree ("run_at","completed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_kind_ref_uq" ON "scheduled_jobs" USING btree ("kind","ref_id","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_uq" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "venues_city_type_idx" ON "venues" USING btree ("city","type");--> statement-breakpoint
CREATE INDEX "verifications_venue_idx" ON "verifications" USING btree ("venue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_ext_uq" ON "webhook_events" USING btree ("provider","external_id");