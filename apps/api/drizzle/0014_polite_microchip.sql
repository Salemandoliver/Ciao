CREATE TABLE "partner_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"surface" varchar(24) DEFAULT 'home' NOT NULL,
	"locale" varchar(2) DEFAULT 'ar' NOT NULL,
	"status" varchar(12) DEFAULT 'new' NOT NULL,
	"note" text,
	"claimed_by_id" uuid,
	"claimed_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partner_leads" ADD CONSTRAINT "partner_leads_claimed_by_id_users_id_fk" FOREIGN KEY ("claimed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_leads_phone_uq" ON "partner_leads" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "partner_leads_status_idx" ON "partner_leads" USING btree ("status","created_at");