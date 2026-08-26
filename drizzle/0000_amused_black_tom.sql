CREATE TYPE "public"."actor_type" AS ENUM('dealer_user', 'applicant', 'system', 'cron');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('draft', 'link_sent', 'client_submitted', 'processing_documents', 'documents_review_required', 'documents_verified', 'awaiting_openfinance_consent', 'openfinance_authorized', 'openfinance_failed', 'running_checks', 'manual_review', 'approved', 'denied', 'offer_created', 'offer_sent', 'offer_accepted', 'offer_declined', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."consent_type" AS ENUM('data_processing', 'bureau_check', 'openfinance_share', 'ai_narrative_share');--> statement-breakpoint
CREATE TYPE "public"."credit_outcome" AS ENUM('approved', 'denied', 'manual_review');--> statement-breakpoint
CREATE TYPE "public"."dealer_role" AS ENUM('admin', 'manager', 'analyst');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('uploaded', 'extracting', 'extracted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('rg', 'cpf', 'cnh', 'comprovante_renda', 'comprovante_residencia');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('draft', 'sent', 'accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."uploaded_by" AS ENUM('applicant', 'dealer');--> statement-breakpoint
CREATE TABLE "applicants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name_encrypted" text NOT NULL,
	"cpf_encrypted" text NOT NULL,
	"cpf_hash" text NOT NULL,
	"birth_date_encrypted" text,
	"phone_encrypted" text NOT NULL,
	"email_encrypted" text NOT NULL,
	"address_encrypted" text,
	"monthly_income_declared_encrypted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applicants_cpf_hash_unique" UNIQUE("cpf_hash")
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"dealer_user_id" uuid NOT NULL,
	"vehicle_make" text NOT NULL,
	"vehicle_model" text NOT NULL,
	"vehicle_year" integer NOT NULL,
	"vehicle_price" real NOT NULL,
	"down_payment" real DEFAULT 0 NOT NULL,
	"requested_amount" real NOT NULL,
	"requested_term_months" integer NOT NULL,
	"status" "application_status" DEFAULT 'draft' NOT NULL,
	"client_portal_token" text NOT NULL,
	"client_portal_token_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	CONSTRAINT "applications_client_portal_token_unique" UNIQUE("client_portal_token")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"application_id" uuid,
	"metadata_json" jsonb,
	"ip_address" text
);
--> statement-breakpoint
CREATE TABLE "bureau_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"provider" text DEFAULT 'mock-serasa' NOT NULL,
	"score" integer NOT NULL,
	"has_restriction" boolean NOT NULL,
	"restriction_details_json" jsonb,
	"raw_response_json" jsonb,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"consent_type" "consent_type" NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_address" text,
	"privacy_policy_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"outcome" "credit_outcome" NOT NULL,
	"score_used" integer NOT NULL,
	"factors_json" jsonb NOT NULL,
	"risk_narrative_dealer" text,
	"risk_narrative_applicant" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dealer_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "dealer_role" DEFAULT 'analyst' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "dealer_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"type" "document_type" NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by" "uploaded_by" NOT NULL,
	"status" "document_status" DEFAULT 'uploaded' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"amount" real NOT NULL,
	"term_months" integer NOT NULL,
	"interest_rate" real NOT NULL,
	"monthly_payment" real NOT NULL,
	"status" "offer_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_dealer_user_id_dealer_users_id_fk" FOREIGN KEY ("dealer_user_id") REFERENCES "public"."dealer_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_decided_by_dealer_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."dealer_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bureau_checks" ADD CONSTRAINT "bureau_checks_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_decisions" ADD CONSTRAINT "credit_decisions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_decisions" ADD CONSTRAINT "credit_decisions_decided_by_dealer_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."dealer_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_offers" ADD CONSTRAINT "loan_offers_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;