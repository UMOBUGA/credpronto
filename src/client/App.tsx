import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/shared/lib/api'
import { STATUS_LABELS } from '@/shared/statusLabels'
import type { ApplicationStatus, DocumentSummary } from '@/shared/types'
import { PersonalDataForm } from './components/PersonalDataForm'
import { DocumentsSection } from './components/DocumentsSection'

interface ClientView {
  status: ApplicationStatus
  vehicle: { make: string; model: string; year: number; price: number }
  requestedAmount: number
  requestedTermMonths: number
  hasSubmittedDetails: boolean
  documents: DocumentSummary[]
  decision: {
    outcome: 'approved' | 'denied' | 'manual_review'
    riskNarrativeApplicant: string | null
  } | null
}

const OUTCOME_LABELS: Record<'approved' | 'denied' | 'manual_review', string> = {
  approved: 'Sua proposta foi aprovada',
  denied: 'Sua proposta não foi aprovada',
  manual_review: 'Sua proposta está em análise pela equipe da loja',
}

function getTokenFromPath(): string | null {
  const match = /^\/portal\/([^/]+)/.exec(window.location.pathname)
  return match?.[1] ?? null
}

export default function App() {
  const token = getTokenFromPath()
  const queryClient = useQueryClient()
  const queryKey = ['client-application', token]

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => apiFetch<ClientView>(`/api/client/${token}`),
    enabled: Boolean(token),
  })

  if (!token) {
    return (
      <div className="client-page">
        <p>Link inválido.</p>
      </div>
    )
  }
  if (isLoading) {
    return (
      <div className="client-page">
        <p>Carregando…</p>
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="client-page">
        <p>Não encontramos essa proposta. O link pode ter expirado — fale com a loja.</p>
      </div>
    )
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey })

  return (
    <div className="client-page">
      <h1>
        Sua proposta — {data.vehicle.make} {data.vehicle.model}
      </h1>
      <p>{STATUS_LABELS[data.status]}</p>

      {!data.hasSubmittedDetails ? (
        <PersonalDataForm token={token} onSubmitted={invalidate} />
      ) : (
        <DocumentsSection token={token} documents={data.documents} onUploaded={invalidate} />
      )}

      {data.decision && (
        <div className="client-card">
          <h2>{OUTCOME_LABELS[data.decision.outcome]}</h2>
          {data.decision.riskNarrativeApplicant && <p>{data.decision.riskNarrativeApplicant}</p>}
        </div>
      )}
    </div>
  )
}
