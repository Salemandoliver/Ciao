ALTER TABLE "bookings" ADD COLUMN "adults" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "child_ages" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "extra_beds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "requirements_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "requirements_accepted" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "source" varchar(12);--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "weekend_supplement" bigint;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "thursday_supplement" bigint;