import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/shared/lib/api'
import { formatCpf, formatCurrency, formatDate } from '@/shared/lib/format'
import { STATUS_LABELS } from '@/shared/statusLabels'
import type { ConsentType, ApplicationDetail } from '@/shared/types'
import { DocumentReviewCard } from '../components/DocumentReviewCard'
import { AuditLogPanel } from '../components/AuditLogPanel'
import { useSession } from '../hooks/useSession'

const REVEAL_ROLES = new Set(['admin', 'manager'])

const CONSENT_TYPES: ConsentType[] = [
  'data_processing',
  'bureau_check',
  'ai_narrative_share',
  'openfinance_share',
]

const CONSENT_LABELS: Record<ConsentType, string> = {
  data_processing: 'Tratamento de dados (LGPD)',
  bureau_check: 'Consulta ao bureau de crédito',
  ai_narrative_share: 'Parecer de risco gerado por IA',
  openfinance_share: 'Compartilhamento via Open Finance',
}

export default function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const queryKey = ['application', id]
  const { data: session } = useSession()
  const canReveal = Boolean(session?.user && REVEAL_ROLES.has(session.user.role))

  const [revealedCpf, setRevealedCpf] = useState<string | null>(null)
  const [revealedIncome, setRevealedIncome] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => apiFetch<ApplicationDetail>(`/api/applications/${id}`),
    enabled: Boolean(id),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey })

  const revealCpf = useMutation({
    mutationFn: () =>
      apiFetch<{ value: string }>(`/api/applications/${id}/reveal`, {
        method: 'POST',
        body: JSON.stringify({ field: 'cpf' }),
      }),
    onSuccess: (result) => setRevealedCpf(result.value),
  })

  const revealIncome = useMutation({
    mutationFn: () =>
      apiFetch<{ value: number | null }>(`/api/applications/${id}/reveal`, {
        method: 'POST',
        body: JSON.stringify({ field: 'monthlyIncomeDeclared' }),
      }),
    onSuccess: (result) => setRevealedIncome(result.value),
  })

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

  const resendLink = useMutation({
    mutationFn: () => apiFetch(`/api/applications/${id}/link`, { method: 'POST' }),
    onSuccess: invalidate,
  })

  if (isLoading || !data) return <div className="page">Carregando…</div>

  const portalUrl = `${window.location.origin}/portal/${data.clientPortalToken}`

  return (
    <div className="page">
      <Link to="/" className="back-link">
        ← Voltar para propostas
      </Link>
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
          <dd>
            {revealedCpf ? formatCpf(revealedCpf) : data.applicant.cpfMasked}
            {canReveal && !revealedCpf && (
              <button
                type="button"
                className="button-link"
                onClick={() => revealCpf.mutate()}
                disabled={revealCpf.isPending}
              >
                {revealCpf.isPending ? 'Revelando…' : 'Revelar'}
              </button>
            )}
          </dd>
          <dt>Telefone</dt>
          <dd>{data.applicant.phone}</dd>
          <dt>E-mail</dt>
          <dd>{data.applicant.email}</dd>
          {data.applicant.hasMonthlyIncomeDeclared && (
            <>
              <dt>Renda declarada</dt>
              <dd>
                {revealedIncome != null ? (
                  formatCurrency(revealedIncome)
                ) : (
                  <>
                    ••••••
                    {canReveal && (
                      <button
                        type="button"
                        className="button-link"
                        onClick={() => revealIncome.mutate()}
                        disabled={revealIncome.isPending}
                      >
                        {revealIncome.isPending ? 'Revelando…' : 'Revelar'}
                      </button>
                    )}
                  </>
                )}
              </dd>
            </>
          )}
        </dl>
        {!canReveal && (
          <p className="hint-text">
            CPF e renda ficam mascarados — só admin/manager podem revelar (cada revelação é
            auditada).
          </p>
        )}
      </section>

      <section className="detail-section">
        <h2>Link do cliente</h2>
        <p>
          <code>{portalUrl}</code>
        </p>
        <button
          type="button"
          className="button-secondary"
          onClick={() => resendLink.mutate()}
          disabled={resendLink.isPending}
        >
          {resendLink.isPending ? 'Gerando novo link…' : 'Reenviar link'}
        </button>
        {resendLink.isSuccess && (
          <p className="hint-text">Link renovado — o anterior parou de funcionar.</p>
        )}
      </section>

      <section className="detail-section">
        <h2>Consentimentos</h2>
        <dl>
          {CONSENT_TYPES.map((type) => {
            const consent = data.consents.find((c) => c.consentType === type)
            return (
              <div key={type} className="document-field-row">
                <dt>{CONSENT_LABELS[type]}</dt>
                <dd>
                  {!consent
                    ? 'Não concedido'
                    : consent.revokedAt
                      ? `Revogado em ${formatDate(consent.revokedAt)}`
                      : `Concedido em ${formatDate(consent.grantedAt)}`}
                </dd>
              </div>
            )
          })}
        </dl>
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

      {data.latestOpenfinanceConsent && (
        <section className="detail-section">
          <h2>Open Finance (simulado)</h2>
          <p>
            Consentimento:{' '}
            {data.latestOpenfinanceConsent.status === 'authorized'
              ? 'Autorizado'
              : 'Não autorizado'}
          </p>
          {data.latestOpenfinanceConsent.monthlyIncomeEstimate != null && (
            <p>
              Renda estimada: {formatCurrency(data.latestOpenfinanceConsent.monthlyIncomeEstimate)}
            </p>
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
            {runBureauCheck.isPending ? 'Verificando…' : 'Verificar documentos'}
          </button>
        )}
        {(data.status === 'openfinance_authorized' || data.status === 'openfinance_failed') && (
          <button onClick={() => runBureauCheck.mutate()} disabled={runBureauCheck.isPending}>
            {runBureauCheck.isPending
              ? 'Consultando…'
              : 'Rodar verificações (bureau, veículo, antifraude)'}
          </button>
        )}
        {data.status === 'awaiting_openfinance_consent' && (
          <p className="hint-text">Aguardando o cliente autorizar (ou não) o Open Finance.</p>
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

      <AuditLogPanel applicationId={data.id} />
    </div>
  )
}
