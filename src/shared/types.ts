export type ApplicationStatus =
  | 'draft'
  | 'link_sent'
  | 'client_submitted'
  | 'processing_documents'
  | 'documents_review_required'
  | 'documents_verified'
  | 'awaiting_openfinance_consent'
  | 'openfinance_authorized'
  | 'openfinance_failed'
  | 'running_checks'
  | 'manual_review'
  | 'approved'
  | 'denied'
  | 'offer_created'
  | 'offer_sent'
  | 'offer_accepted'
  | 'offer_declined'
  | 'expired'
  | 'cancelled'

export interface DealerUser {
  id: string
  name: string
  email: string
  role: 'admin' | 'manager' | 'analyst'
}

/**
 * Só usada pela tela de gestão de usuários (Fase 17, `admin`) —
 * `GET /api/auth/session` devolve `DealerUser` puro, sem esses dois campos.
 */
export interface DealerUserManagementEntry extends DealerUser {
  createdAt: string
  disabledAt: string | null
}

export interface ApplicationSummary {
  id: string
  applicantId: string
  dealerUserId: string
  vehicleMake: string
  vehicleModel: string
  vehicleYear: number
  vehiclePrice: number
  vehiclePlate: string
  downPayment: number
  requestedAmount: number
  requestedTermMonths: number
  status: ApplicationStatus
  clientPortalToken: string
  createdAt: string
  updatedAt: string
}

export type DocumentType =
  'rg' | 'cpf' | 'cnh' | 'passaporte' | 'comprovante_renda' | 'comprovante_residencia'

export interface DocumentExtractionSummary {
  id: string
  status: 'auto_accepted' | 'needs_review' | 'reviewed' | 'rejected'
  confidenceScore: number
  fields: Record<string, string>
  reviewedAt: string | null
}

export interface DocumentSummary {
  id: string
  type: DocumentType
  status: 'uploaded' | 'extracting' | 'extracted' | 'failed'
  mimeType?: string
  createdAt?: string
  extraction?: DocumentExtractionSummary | null
  /** Dado digitado pelo cliente junto com a foto no envio (Fase 8) — ver `documentTypes.ts`. */
  manualFields?: Record<string, string> | null
}

export interface BureauCheckSummary {
  id: string
  score: number
  hasRestriction: boolean
  checkedAt: string
}

export interface CreditDecisionSummary {
  id: string
  outcome: 'approved' | 'denied' | 'manual_review'
  scoreUsed: number
  riskNarrativeDealer: string | null
  riskNarrativeApplicant: string | null
  decidedAt: string
}

export interface VehicleCheckSummary {
  id: string
  fipeValue: number | null
  fipeCode: string | null
  fipeBrand: string | null
  fipeModel: string | null
  fipeYear: string | null
  restrictionFound: boolean
  checkedAt: string
}

export interface AntifraudCheckSummary {
  id: string
  riskScore: number
  flagsJson: string[]
  checkedAt: string
}

export interface OpenfinanceConsentSummary {
  id: string
  status: 'awaiting_authorization' | 'authorized' | 'rejected' | 'revoked' | 'expired'
  authorizedAt: string | null
  monthlyIncomeEstimate: number | null
}

export interface LoanOfferSummary {
  id: string
  amount: number
  termMonths: number
  interestRate: number
  monthlyPayment: number
  status: 'draft' | 'sent' | 'accepted' | 'declined'
}

/**
 * CPF e renda declarada vêm mascarados por padrão (Fase 6, LGPD) — só
 * `POST /api/applications/[id]/reveal` (restrito a admin/manager) devolve o
 * valor em claro, e cada chamada gera uma entrada própria de auditoria.
 */
export interface ApplicantDetail {
  id: string
  fullName: string
  cpfMasked: string
  phone: string
  email: string
  birthDate: string | null
  address: { street: string; number: string; city: string; state: string; zip: string } | null
  hasMonthlyIncomeDeclared: boolean
}

export type ConsentType =
  'data_processing' | 'bureau_check' | 'openfinance_share' | 'ai_narrative_share'

export interface ConsentRecordSummary {
  id: string
  consentType: ConsentType
  grantedAt: string
  revokedAt: string | null
}

export type NotificationTemplate = 'link_sent' | 'decision_ready' | 'offer_created'

/**
 * Só prova que uma notificação foi disparada (Fase 16) — nunca carrega
 * destinatário/conteúdo, ver `api/_lib/schema.ts::notificationLog`.
 */
export interface NotificationLogEntry {
  id: string
  template: NotificationTemplate
  status: 'sent' | 'failed'
  sentAt: string
}

export interface AuditLogEntry {
  id: string
  occurredAt: string
  actorType: 'dealer_user' | 'applicant' | 'system' | 'cron'
  actorId: string | null
  action: string
  entityType: string
  entityId: string
  metadataJson: Record<string, unknown> | null
}

export interface ApplicationDetail extends ApplicationSummary {
  applicant: ApplicantDetail
  documents: DocumentSummary[]
  latestBureauCheck: BureauCheckSummary | null
  latestVehicleCheck: VehicleCheckSummary | null
  latestAntifraudCheck: AntifraudCheckSummary | null
  latestOpenfinanceConsent: OpenfinanceConsentSummary | null
  latestDecision: CreditDecisionSummary | null
  offers: LoanOfferSummary[]
  consents: ConsentRecordSummary[]
  notifications: NotificationLogEntry[]
}
