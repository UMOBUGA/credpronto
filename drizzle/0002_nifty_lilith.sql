CREATE TABLE "antifraud_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"risk_score" integer NOT NULL,
	"flags_json" jsonb NOT NULL,
	"provider" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"fipe_value" real,
	"fipe_code" text,
	"fipe_brand" text,
	"fipe_model" text,
	"fipe_year" text,
	"restriction_found" boolean NOT NULL,
	"restriction_details_json" jsonb,
	"source" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "vehicle_plate" text NOT NULL;--> statement-breakpoint
ALTER TABLE "antifraud_checks" ADD CONSTRAINT "antifraud_checks_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_checks" ADD CONSTRAINT "vehicle_checks_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;