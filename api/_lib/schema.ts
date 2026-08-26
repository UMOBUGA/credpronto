import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Colunas com sufixo `_encrypted` guardam texto cifrado (AES-256-GCM, ver
 * `api/_lib/crypto.ts`), nunca o valor em claro — por isso são sempre `text`,
 * mesmo quando o dado original é uma data ou um número. `cpf_hash` é um HMAC
 * não-reversível: permite busca por igualdade (dedupe de proponente) sem
 * nunca decriptar. Ler qualquer coluna `_encrypted` deve passar por
 * `decryptField` em `crypto.ts`, que por sua vez grava em `auditLog` — a
 * auditoria de acesso a PII é uma propriedade do código, não uma convenção.
 */

export const dealerRoleEnum = pgEnum('dealer_role', ['admin', 'manager', 'analyst'])

export const dealerUsers = pgTable('dealer_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: dealerRoleEnum('role').notNull().default('analyst'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
})

export const applicants = pgTable('applicants', {
  id: uuid('id').primaryKey().defaultRandom(),
  fullNameEncrypted: text('full_name_encrypted').notNull(),
  cpfEncrypted: text('cpf_encrypted').notNull(),
  cpfHash: text('cpf_hash').notNull().unique(),
  // Preenchido pelo próprio cliente no portal (`client/[token]/submit.ts`),
  // não pelo dealer na criação — por isso nullable, diferente dos campos de
  // identidade/contato que o vendedor já coleta na hora.
  birthDateEncrypted: text('birth_date_encrypted'),
  phoneEncrypted: text('phone_encrypted').notNull(),
  emailEncrypted: text('email_encrypted').notNull(),
  addressEncrypted: text('address_encrypted'),
  monthlyIncomeDeclaredEncrypted: text('monthly_income_declared_encrypted'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Grafo de transição completo em `api/_lib/stateMachine.ts` — este enum só
 * declara os valores possíveis, quem decide o que é válido de onde é o
 * `canTransition`.
 */
export const applicationStatusEnum = pgEnum('application_status', [
  'draft',
  'link_sent',
  'client_submitted',
  'processing_documents',
  'documents_review_required',
  'documents_verified',
  'awaiting_openfinance_consent',
  'openfinance_authorized',
  'openfinance_failed',
  'running_checks',
  'manual_review',
  'approved',
  'denied',
  'offer_created',
  'offer_sent',
  'offer_accepted',
  'offer_declined',
  'expired',
  'cancelled',
])

export const applications = pgTable('applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicantId: uuid('applicant_id')
    .notNull()
    .references(() => applicants.id),
  dealerUserId: uuid('dealer_user_id')
    .notNull()
    .references(() => dealerUsers.id),
  vehicleMake: text('vehicle_make').notNull(),
  vehicleModel: text('vehicle_model').notNull(),
  vehicleYear: integer('vehicle_year').notNull(),
  vehiclePrice: real('vehicle_price').notNull(),
  downPayment: real('down_payment').notNull().default(0),
  requestedAmount: real('requested_amount').notNull(),
  requestedTermMonths: integer('requested_term_months').notNull(),
  status: applicationStatusEnum('status').notNull().default('draft'),
  clientPortalToken: text('client_portal_token').notNull().unique(),
  clientPortalTokenExpiresAt: timestamp('client_portal_token_expires_at', {
    withTimezone: true,
  }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decidedBy: uuid('decided_by').references(() => dealerUsers.id),
})

export const documentTypeEnum = pgEnum('document_type', [
  'rg',
  'cpf',
  'cnh',
  'comprovante_renda',
  'comprovante_residencia',
])
export const documentStatusEnum = pgEnum('document_status', [
  'uploaded',
  'extracting',
  'extracted',
  'failed',
])
export const uploadedByEnum = pgEnum('uploaded_by', ['applicant', 'dealer'])

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id')
    .notNull()
    .references(() => applications.id),
  type: documentTypeEnum('type').notNull(),
  storageKey: text('storage_key').notNull(),
  uploadedBy: uploadedByEnum('uploaded_by').notNull(),
  status: documentStatusEnum('status').notNull().default('uploaded'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Bureau real (Serasa/SPC) exige CNPJ e contrato comercial — inviável para
 * projeto de portfólio. `provider` fica travado em 'mock-serasa' até que
 * (se algum dia) um provider real seja integrado.
 */
export const bureauChecks = pgTable('bureau_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id')
    .notNull()
    .references(() => applications.id),
  provider: text('provider').notNull().default('mock-serasa'),
  score: integer('score').notNull(),
  hasRestriction: boolean('has_restriction').notNull(),
  restrictionDetailsJson: jsonb('restriction_details_json'),
  rawResponseJson: jsonb('raw_response_json'),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
})

export const creditOutcomeEnum = pgEnum('credit_outcome', ['approved', 'denied', 'manual_review'])

/**
 * `riskNarrative*` é gerado por IA (Claude) a partir de `factorsJson` — mas
 * só depois do motor determinístico em `decision.ts` já ter decidido
 * `outcome`. A IA nunca decide o crédito, só explica uma decisão já tomada;
 * por isso os dois campos são nullable e a decisão persiste mesmo se a
 * chamada de parecer falhar (ver Fase 3 do plano).
 */
export const creditDecisions = pgTable('credit_decisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id')
    .notNull()
    .references(() => applications.id),
  outcome: creditOutcomeEnum('outcome').notNull(),
  scoreUsed: integer('score_used').notNull(),
  factorsJson: jsonb('factors_json').notNull(),
  riskNarrativeDealer: text('risk_narrative_dealer'),
  riskNarrativeApplicant: text('risk_narrative_applicant'),
  decidedBy: uuid('decided_by').references(() => dealerUsers.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const offerStatusEnum = pgEnum('offer_status', ['draft', 'sent', 'accepted', 'declined'])

export const loanOffers = pgTable('loan_offers', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id')
    .notNull()
    .references(() => applications.id),
  amount: real('amount').notNull(),
  termMonths: integer('term_months').notNull(),
  interestRate: real('interest_rate').notNull(),
  monthlyPayment: real('monthly_payment').notNull(),
  status: offerStatusEnum('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Consentimento LGPD (tratamento de dado) — distinto do consentimento
 * financeiro regulatório do Open Finance (`openfinance_consents`, Fase 4).
 * Os dois são modelados de verdade porque respondem perguntas diferentes:
 * "o titular deixou eu processar o dado dele" vs. "o titular autorizou o
 * banco a compartilhar o dado financeiro dele comigo".
 */
export const consentTypeEnum = pgEnum('consent_type', [
  'data_processing',
  'bureau_check',
  'openfinance_share',
  'ai_narrative_share',
])

export const consentRecords = pgTable('consent_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicantId: uuid('applicant_id')
    .notNull()
    .references(() => applicants.id),
  applicationId: uuid('application_id')
    .notNull()
    .references(() => applications.id),
  consentType: consentTypeEnum('consent_type').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  ipAddress: text('ip_address'),
  privacyPolicyVersion: text('privacy_policy_version').notNull(),
})

export const actorTypeEnum = pgEnum('actor_type', ['dealer_user', 'applicant', 'system', 'cron'])

/**
 * `metadataJson` guarda nome de campo/tipo de ação, nunca o valor de PII em
 * si (ex.: `{ field: 'cpf' }`, nunca `{ cpf: '123.456.789-00' }`) — é a regra
 * que torna essa tabela auditável sem ela mesma virar um vazamento de dado.
 */
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  actorType: actorTypeEnum('actor_type').notNull(),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  applicationId: uuid('application_id'),
  metadataJson: jsonb('metadata_json'),
  ipAddress: text('ip_address'),
})

export type DealerUser = typeof dealerUsers.$inferSelect
export type NewDealerUser = typeof dealerUsers.$inferInsert
export type Applicant = typeof applicants.$inferSelect
export type NewApplicant = typeof applicants.$inferInsert
export type Application = typeof applications.$inferSelect
export type NewApplication = typeof applications.$inferInsert
export type ApplicationStatus = Application['status']
export type Document = typeof documents.$inferSelect
export type NewDocument = typeof documents.$inferInsert
export type BureauCheck = typeof bureauChecks.$inferSelect
export type NewBureauCheck = typeof bureauChecks.$inferInsert
export type CreditDecision = typeof creditDecisions.$inferSelect
export type NewCreditDecision = typeof creditDecisions.$inferInsert
export type LoanOffer = typeof loanOffers.$inferSelect
export type NewLoanOffer = typeof loanOffers.$inferInsert
export type ConsentRecord = typeof consentRecords.$inferSelect
export type NewConsentRecord = typeof consentRecords.$inferInsert
export type AuditLogEntry = typeof auditLog.$inferSelect
export type NewAuditLogEntry = typeof auditLog.$inferInsert
