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

export interface ApplicationSummary {
  id: string
  applicantId: string
  dealerUserId: string
  vehicleMake: string
  vehicleModel: string
  vehicleYear: number
  vehiclePrice: number
  downPayment: number
  requestedAmount: number
  requestedTermMonths: number
  status: ApplicationStatus
  clientPortalToken: string
  createdAt: string
  updatedAt: string
}

export interface DocumentSummary {
  id: string
  type: 'rg' | 'cpf' | 'cnh' | 'comprovante_renda' | 'comprovante_residencia'
  status: 'uploaded' | 'extracting' | 'extracted' | 'failed'
  createdAt?: string
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

export interface LoanOfferSummary {
  id: string
  amount: number
  termMonths: number
  interestRate: number
  monthlyPayment: number
  status: 'draft' | 'sent' | 'accepted' | 'declined'
}

export interface ApplicantDetail {
  id: string
  fullName: string
  cpf: string
  phone: string
  email: string
  birthDate: string | null
  address: { street: string; number: string; city: string; state: string; zip: string } | null
  monthlyIncomeDeclared: number | null
}

export interface ApplicationDetail extends ApplicationSummary {
  applicant: ApplicantDetail
  documents: DocumentSummary[]
  latestBureauCheck: BureauCheckSummary | null
  latestDecision: CreditDecisionSummary | null
  offers: LoanOfferSummary[]
}
