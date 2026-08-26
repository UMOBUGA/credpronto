CREATE TYPE "public"."document_extraction_status" AS ENUM('auto_accepted', 'needs_review', 'reviewed', 'rejected');--> statement-breakpoint
CREATE TABLE "document_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"extracted_fields_encrypted" text NOT NULL,
	"confidence_score" real NOT NULL,
	"model_used" text NOT NULL,
	"status" "document_extraction_status" NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "mime_type" text NOT NULL;--> statement-breakpoint
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_reviewed_by_dealer_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."dealer_users"("id") ON DELETE no action ON UPDATE no action;