CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"name" varchar(48) NOT NULL,
	"user_id" uuid,
	"anon_id" varchar(40),
	"session_id" varchar(40),
	"source" varchar(8) DEFAULT 'api' NOT NULL,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"context" jsonb
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"traits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_event_ts" timestamp with time zone,
	"fold_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_name_ts_idx" ON "events" USING btree ("name","ts");--> statement-breakpoint
CREATE INDEX "events_user_ts_idx" ON "events" USING btree ("user_id","ts");--> statement-breakpoint
CREATE INDEX "events_anon_ts_idx" ON "events" USING btree ("anon_id","ts");