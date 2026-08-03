CREATE TABLE "biz_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"password_hash" text NOT NULL,
	"password_set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"must_change" boolean DEFAULT false NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"last_login_ip" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biz_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"device_label" text,
	"ip" varchar(45),
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "biz_credentials" ADD CONSTRAINT "biz_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biz_sessions" ADD CONSTRAINT "biz_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "biz_sessions_user_idx" ON "biz_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "biz_sessions_token_uq" ON "biz_sessions" USING btree ("token_hash");