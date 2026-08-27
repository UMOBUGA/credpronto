import type { ApplicationStatus } from '@/shared/types'

const STEPS = ['Dados', 'Documentos', 'Open Finance', 'Decisão']

/**
 * Passo atual derivado do `status` que `/api/client/[token]` já devolve —
 * só apresentação, nenhuma mudança de API. Estados pré-cadastro e
 * terminais de encerramento sem decisão (expired/cancelled) ficam no passo
 * 0: não fazem parte do progresso normal de quem está preenchendo a
 * proposta.
 */
const STEP_BY_STATUS: Record<ApplicationStatus, number> = {
  draft: 0,
  link_sent: 0,
  client_submitted: 1,
  processing_documents: 1,
  documents_review_required: 1,
  documents_verified: 1,
  awaiting_openfinance_consent: 2,
  openfinance_authorized: 2,
  openfinance_failed: 2,
  running_checks: 3,
  manual_review: 3,
  approved: 3,
  denied: 3,
  offer_created: 3,
  offer_sent: 3,
  offer_accepted: 3,
  offer_declined: 3,
  expired: 0,
  cancelled: 0,
}

export function ProgressStepper({ status }: { status: ApplicationStatus }) {
  const currentStep = STEP_BY_STATUS[status]

  return (
    <ol className="progress-stepper">
      {STEPS.map((label, index) => (
        <li
          key={label}
          className={index === currentStep ? 'is-current' : index < currentStep ? 'is-done' : ''}
        >
          {label}
        </li>
      ))}
    </ol>
  )
}
