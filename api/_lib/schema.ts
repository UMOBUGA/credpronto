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
  // Obrigatória desde a Fase 3 — a loja já sabe a placa do carro do próprio
  // estoque, e a consulta veicular simulada (vehicleRestriction.ts) precisa
  // dela.
  vehiclePlate: text('vehicle_plate').notNull(),
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
  // Necessário pra montar o content block certo (`image` vs `document`) na
  // chamada de extração (Fase 2, `api/_lib/claude.ts`) — o storageKey por si
  // só não carrega o tipo do arquivo.
  mimeType: text('mime_type').notNull(),
  uploadedBy: uploadedByEnum('uploaded_by').notNull(),
  status: documentStatusEnum('status').notNull().default('uploaded'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Uma linha por tentativa de extração (uma nova a cada retry) — nunca
 * sobrescreve a anterior, então o histórico de tentativas fica preservado.
 * `auto_accepted`/`needs_review` são decididos pelo pipeline (confiança do
 * modelo + checksum de CPF, ver `documentExtraction.ts`); `reviewed` e
 * `rejected` só acontecem por ação humana em `api/documents/[id]/extract.ts`.
 */
export const documentExtractionStatusEnum = pgEnum('document_extraction_status', [
  'auto_accepted',
  'needs_review',
  'reviewed',
  'rejected',
])

export const documentExtractions = pgTable('document_extractions', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id')
    .notNull()
    .references(() => documents.id),
  extractedFieldsEncrypted: text('extracted_fields_encrypted').notNull(),
  confidenceScore: real('confidence_score').notNull(),
  modelUsed: text('model_used').notNull(),
  status: documentExtractionStatusEnum('status').notNull(),
  reviewedBy: uuid('reviewed_by').references(() => dealerUsers.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
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

/**
 * Preço FIPE real (BrasilAPI, ver `api/_lib/fipe.ts`) + restrição de
 * roubo/furto/gravame simulada (`vehicleRestriction.ts` — não existe API
 * pública gratuita pra isso no Brasil). As duas metades ficam na mesma
 * linha porque representam uma única "consulta veicular" do ponto de vista
 * do dealer, mesmo vindo de fontes com credibilidade bem diferente — os
 * campos `fipe*` ficam `null` quando a busca não encontra correspondência
 * (marca/modelo digitado não bate com o nome exato da FIPE) ou a API está
 * fora, nunca travando a esteira por isso.
 */
export const vehicleChecks = pgTable('vehicle_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id')
    .notNull()
    .references(() => applications.id),
  fipeValue: real('fipe_value'),
  fipeCode: text('fipe_code'),
  fipeBrand: text('fipe_brand'),
  fipeModel: text('fipe_model'),
  fipeYear: text('fipe_year'),
  restrictionFound: boolean('restriction_found').notNull(),
  restrictionDetailsJson: jsonb('restriction_details_json'),
  source: text('source').notNull(),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * `flagsJson` combina sinais reais (cross-validation contra o que a IA
 * extraiu do documento na Fase 2 — CPF/nome declarados vs. extraídos,
 * idade mínima) com um mock de "consulta a uma base de fraudadores
 * conhecidos" (provider real exigiria contrato comercial, mesma limitação
 * do bureau).
 */
export const antifraudChecks = pgTable('antifraud_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id')
    .notNull()
    .references(() => applications.id),
  riskScore: integer('risk_score').notNull(),
  flagsJson: jsonb('flags_json').notNull(),
  provider: text('provider').notNull(),
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
 * Open Finance **simulado** (Fase 5) — participar de verdade, mesmo em
 * sandbox, exige a instituição ser autorizada pelo Banco Central (ver
 * CLAUDE.md/README, não é cadastro de desenvolvedor). `provider_consent_id`
 * e os tokens são gerados por `MockOpenFinanceClient`
 * (`api/_lib/openfinance.ts`), nunca por um banco de verdade. Mesmo assim
 * os tokens ficam criptografados como se fossem reais — a tabela existe
 * pra modelar corretamente o formato de um consentimento regulatório, só a
 * origem do dado é que é simulada.
 */
export const openfinanceConsentStatusEnum = pgEnum('openfinance_consent_status', [
  'awaiting_authorization',
  'authorized',
  'rejected',
  'revoked',
  'expired',
])

export const openfinanceConsents = pgTable('openfinance_consents', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id')
    .notNull()
    .references(() => applications.id),
  providerConsentId: text('provider_consent_id').notNull(),
  status: openfinanceConsentStatusEnum('status').notNull().default('awaiting_authorization'),
  scopesJson: jsonb('scopes_json').notNull(),
  accessTokenEncrypted: text('access_token_encrypted'),
  refreshTokenEncrypted: text('refresh_token_encrypted'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  authorizedAt: timestamp('authorized_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
})

export const openfinanceDataTypeEnum = pgEnum('openfinance_data_type', [
  'accounts',
  'transactions',
  'income',
])

export const openfinanceData = pgTable('openfinance_data', {
  id: uuid('id').primaryKey().defaultRandom(),
  consentId: uuid('consent_id')
    .notNull()
    .references(() => openfinanceConsents.id),
  dataType: openfinanceDataTypeEnum('data_type').notNull(),
  payloadEncrypted: text('payload_encrypted').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Consentimento LGPD (tratamento de dado) — distinto do consentimento
 * financeiro regulatório do Open Finance (`openfinance_consents`, Fase 5,
 * simulado). Os dois são modelados de verdade porque respondem perguntas
 * diferentes: "o titular deixou eu processar o dado dele" vs. "o titular
 * autorizou o banco (simulado) a compartilhar o dado financeiro dele
 * comigo".
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
export type DocumentType = Document['type']
export type DocumentExtraction = typeof documentExtractions.$inferSelect
export type NewDocumentExtraction = typeof documentExtractions.$inferInsert
export type BureauCheck = typeof bureauChecks.$inferSelect
export type NewBureauCheck = typeof bureauChecks.$inferInsert
export type VehicleCheck = typeof vehicleChecks.$inferSelect
export type NewVehicleCheck = typeof vehicleChecks.$inferInsert
export type AntifraudCheck = typeof antifraudChecks.$inferSelect
export type NewAntifraudCheck = typeof antifraudChecks.$inferInsert
export type CreditDecision = typeof creditDecisions.$inferSelect
export type NewCreditDecision = typeof creditDecisions.$inferInsert
export type LoanOffer = typeof loanOffers.$inferSelect
export type NewLoanOffer = typeof loanOffers.$inferInsert
export type OpenfinanceConsent = typeof openfinanceConsents.$inferSelect
export type NewOpenfinanceConsent = typeof openfinanceConsents.$inferInsert
export type OpenfinanceData = typeof openfinanceData.$inferSelect
export type NewOpenfinanceData = typeof openfinanceData.$inferInsert
export type ConsentRecord = typeof consentRecords.$inferSelect
export type NewConsentRecord = typeof consentRecords.$inferInsert
export type AuditLogEntry = typeof auditLog.$inferSelect
export type NewAuditLogEntry = typeof auditLog.$inferInsert
