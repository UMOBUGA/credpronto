CREATE TYPE "public"."openfinance_consent_status" AS ENUM('awaiting_authorization', 'authorized', 'rejected', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."openfinance_data_type" AS ENUM('accounts', 'transactions', 'income');--> statement-breakpoint
CREATE TABLE "openfinance_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"provider_consent_id" text NOT NULL,
	"status" "openfinance_consent_status" DEFAULT 'awaiting_authorization' NOT NULL,
	"scopes_json" jsonb NOT NULL,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"authorized_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "openfinance_data" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consent_id" uuid NOT NULL,
	"data_type" "openfinance_data_type" NOT NULL,
	"payload_encrypted" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "openfinance_consents" ADD CONSTRAINT "openfinance_consents_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openfinance_data" ADD CONSTRAINT "openfinance_data_consent_id_openfinance_consents_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."openfinance_consents"("id") ON DELETE no action ON UPDATE no action;