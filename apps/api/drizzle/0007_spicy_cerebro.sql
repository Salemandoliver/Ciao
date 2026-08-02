ALTER TABLE "user_preferences" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "party_adults" integer;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "party_children" integer;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "child_age_bands" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "occasions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "planned_event_kind" varchar(20);--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "planned_event_date" date;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "profile_completed_at" timestamp with time zone;