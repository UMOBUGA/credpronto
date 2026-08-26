import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/shared/lib/api'
import { formatCpf, formatCurrency } from '@/shared/lib/format'
import { STATUS_LABELS } from '@/shared/statusLabels'
import type { ApplicationDetail } from '@/shared/types'
import { DocumentReviewCard } from '../components/DocumentReviewCard'

export default function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const queryKey = ['application', id]

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => apiFetch<ApplicationDetail>(`/api/applications/${id}`),
    enabled: Boolean(id),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey })

  const runBureauCheck = useMutation({
    mutationFn: () =>
      apiFetch('/api/bureau/check', {
        method: 'POST',
        body: JSON.stringify({ applicationId: id }),
      }),
    onSuccess: invalidate,
  })

  const runDecision = useMutation({
    mutationFn: () => apiFetch(`/api/applications/${id}/decision`, { method: 'POST' }),
    onSuccess: invalidate,
  })

  const resolveManualReview = useMutation({
    mutationFn: (outcome: 'approved' | 'denied') =>
      apiFetch(`/api/applications/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ outcome }),
      }),
    onSuccess: invalidate,
  })

  const createOffer = useMutation({
    mutationFn: () => apiFetch(`/api/applications/${id}/offer`, { method: 'POST', body: '{}' }),
    onSuccess: invalidate,
  })

  const retryNarrative = useMutation({
    mutationFn: () => apiFetch(`/api/applications/${id}/narrative`, { method: 'POST' }),
    onSuccess: invalidate,
  })

  if (isLoading || !data) return <div className="page">Carregando…</div>

  const portalUrl = `${window.location.origin}/portal/${data.clientPortalToken}`

  return (
    <div className="page">
      <h1>
        {data.vehicleMake} {data.vehicleModel} ({data.vehicleYear}) — {data.vehiclePlate}
      </h1>
      <span className={`status-badge status-${data.status}`}>{STATUS_LABELS[data.status]}</span>

      <section className="detail-section">
        <h2>Comprador</h2>
        <dl>
          <dt>Nome</dt>
          <dd>{data.applicant.fullName}</dd>
          <dt>CPF</dt>
          <dd>{formatCpf(data.applicant.cpf)}</dd>
          <dt>Telefone</dt>
          <dd>{data.applicant.phone}</dd>
          <dt>E-mail</dt>
          <dd>{data.applicant.email}</dd>
          {data.applicant.monthlyIncomeDeclared != null && (
            <>
              <dt>Renda declarada</dt>
              <dd>{formatCurrency(data.applicant.monthlyIncomeDeclared)}</dd>
            </>
          )}
        </dl>
      </section>

      <section className="detail-section">
        <h2>Link do cliente</h2>
        <p>
          <code>{portalUrl}</code>
        </p>
      </section>

      <section className="detail-section">
        <h2>Documentos</h2>
        {data.documents.length === 0 ? (
          <p>Nenhum documento enviado ainda.</p>
        ) : (
          data.documents.map((doc) => (
            <DocumentReviewCard
              key={doc.id}
              applicationId={data.id}
              document={doc}
              onChanged={invalidate}
            />
          ))
        )}
      </section>

      {data.latestBureauCheck && (
        <section className="detail-section">
          <h2>Bureau (simulado)</h2>
          <p>
            Score: {data.latestBureauCheck.score} —{' '}
            {data.latestBureauCheck.hasRestriction ? 'Com restrição' : 'Sem restrição'}
          </p>
        </section>
      )}

      {data.latestVehicleCheck && (
        <section className="detail-section">
          <h2>Consulta veicular</h2>
          <p>
            {data.latestVehicleCheck.fipeValue != null ? (
              <>
                Valor FIPE: {formatCurrency(data.latestVehicleCheck.fipeValue)}
                {data.latestVehicleCheck.fipeBrand && data.latestVehicleCheck.fipeModel && (
                  <>
                    {' '}
                    ({data.latestVehicleCheck.fipeBrand} {data.latestVehicleCheck.fipeModel})
                  </>
                )}
              </>
            ) : (
              'Valor FIPE indisponível — marca/modelo não encontrado ou API fora do ar.'
            )}
          </p>
          <p>
            Restrição (roubo/furto/gravame, simulado):{' '}
            {data.latestVehicleCheck.restrictionFound ? 'Encontrada' : 'Não encontrada'}
          </p>
        </section>
      )}

      {data.latestAntifraudCheck && (
        <section className="detail-section">
          <h2>Anti-fraude</h2>
          <p>Score de risco: {data.latestAntifraudCheck.riskScore}/100</p>
          {data.latestAntifraudCheck.flagsJson.length > 0 ? (
            <ul>
              {data.latestAntifraudCheck.flagsJson.map((flag) => (
                <li key={flag}>{flag}</li>
              ))}
            </ul>
          ) : (
            <p>Nenhum sinal de fraude encontrado.</p>
          )}
        </section>
      )}

      {data.latestDecision && (
        <section className="detail-section">
          <h2>Decisão</h2>
          <p>{STATUS_LABELS[data.latestDecision.outcome]}</p>
          {data.latestDecision.riskNarrativeDealer ? (
            <p>{data.latestDecision.riskNarrativeDealer}</p>
          ) : (
            <>
              <p>Parecer de IA ainda não disponível.</p>
              <button onClick={() => retryNarrative.mutate()} disabled={retryNarrative.isPending}>
                {retryNarrative.isPending ? 'Gerando…' : 'Gerar parecer'}
              </button>
            </>
          )}
        </section>
      )}

      <section className="detail-section actions">
        {(data.status === 'client_submitted' || data.status === 'documents_review_required') && (
          <button onClick={() => runBureauCheck.mutate()} disabled={runBureauCheck.isPending}>
            {runBureauCheck.isPending
              ? 'Consultando…'
              : 'Rodar verificações (bureau, veículo, antifraude)'}
          </button>
        )}
        {data.status === 'running_checks' && (
          <button onClick={() => runDecision.mutate()} disabled={runDecision.isPending}>
            {runDecision.isPending ? 'Calculando…' : 'Calcular decisão'}
          </button>
        )}
        {data.status === 'manual_review' && (
          <>
            <button onClick={() => resolveManualReview.mutate('approved')}>
              Aprovar manualmente
            </button>
            <button onClick={() => resolveManualReview.mutate('denied')}>Negar manualmente</button>
          </>
        )}
        {data.status === 'approved' && (
          <button onClick={() => createOffer.mutate()} disabled={createOffer.isPending}>
            {createOffer.isPending ? 'Gerando…' : 'Gerar oferta'}
          </button>
        )}
      </section>

      {data.offers.length > 0 && (
        <section className="detail-section">
          <h2>Ofertas</h2>
          <ul>
            {data.offers.map((offer) => (
              <li key={offer.id}>
                {formatCurrency(offer.amount)} em {offer.termMonths}x de{' '}
                {formatCurrency(offer.monthlyPayment)} — {offer.status}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
