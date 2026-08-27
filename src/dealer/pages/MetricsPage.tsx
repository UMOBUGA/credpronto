import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/shared/lib/api'
import type { MetricsSummary } from '@/shared/types'

function formatHours(hours: number | null): string {
  if (hours == null) return '—'
  if (hours < 1) return `${Math.round(hours * 60)}min`
  if (hours < 48) return `${hours.toFixed(1)}h`
  return `${(hours / 24).toFixed(1)} dias`
}

interface BarRowProps {
  label: string
  count: number
  max: number
}

/**
 * Barra em CSS puro (`width` proporcional) — decisão deliberada de não
 * adicionar Recharts só pra 2-3 gráficos de barra simples; ver CLAUDE.md.
 */
function BarRow({ label, count, max }: BarRowProps) {
  const pct = max > 0 ? (count / max) * 100 : 0
  return (
    <div className="metric-bar-row">
      <span className="metric-bar-label">{label}</span>
      <div className="metric-bar-track">
        <div className="metric-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="metric-bar-count">{count}</span>
    </div>
  )
}

export default function MetricsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['metrics-summary'],
    queryFn: () => apiFetch<MetricsSummary>('/api/metrics/summary'),
  })

  if (isLoading || !data) return <div className="page">Carregando…</div>

  const { outcomeBreakdown, scoreDistribution } = data
  const outcomeMax = Math.max(
    outcomeBreakdown.approved,
    outcomeBreakdown.denied,
    outcomeBreakdown.manual_review,
    1,
  )
  const scoreMax = Math.max(...scoreDistribution.map((bucket) => bucket.count), 1)
  const hasDecisions = data.totalDecisions > 0
  const hasScores = scoreDistribution.some((bucket) => bucket.count > 0)

  return (
    <div className="page">
      <Link to="/" className="back-link">
        ← Voltar para propostas
      </Link>
      <h1 className="page-title">Métricas</h1>

      <div className="stat-chips">
        <div className="stat-chip">
          <strong>{data.statusCounts.total}</strong>
          <span>Propostas no total</span>
        </div>
        <div className="stat-chip">
          <strong>
            {data.approvalRate != null ? `${Math.round(data.approvalRate * 100)}%` : '—'}
          </strong>
          <span>Taxa de aprovação</span>
        </div>
        <div className="stat-chip">
          <strong>{formatHours(data.averageDecisionHours)}</strong>
          <span>Tempo médio até a decisão</span>
        </div>
        <div className="stat-chip">
          <strong>{data.totalDecisions}</strong>
          <span>Decisões registradas</span>
        </div>
      </div>

      <section className="detail-section">
        <h2>Decisões por resultado</h2>
        {hasDecisions ? (
          <div className="metric-bars">
            <BarRow label="Aprovadas" count={outcomeBreakdown.approved} max={outcomeMax} />
            <BarRow label="Negadas" count={outcomeBreakdown.denied} max={outcomeMax} />
            <BarRow
              label="Revisão manual"
              count={outcomeBreakdown.manual_review}
              max={outcomeMax}
            />
          </div>
        ) : (
          <p className="hint-text">Nenhuma decisão registrada ainda.</p>
        )}
      </section>

      <section className="detail-section">
        <h2>Distribuição de score (bureau simulado)</h2>
        {hasScores ? (
          <div className="metric-bars">
            {scoreDistribution.map((bucket) => (
              <BarRow key={bucket.label} label={bucket.label} count={bucket.count} max={scoreMax} />
            ))}
          </div>
        ) : (
          <p className="hint-text">Nenhum score registrado ainda.</p>
        )}
      </section>
    </div>
  )
}
