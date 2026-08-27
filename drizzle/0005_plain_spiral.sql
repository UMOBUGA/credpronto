ALTER TYPE "public"."document_type" ADD VALUE 'passaporte' BEFORE 'comprovante_renda';--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "manual_fields_encrypted" text;