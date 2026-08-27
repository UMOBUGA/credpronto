import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/shared/lib/api'
import { formatCurrency, formatDate } from '@/shared/lib/format'
import { STATUS_LABELS } from '@/shared/statusLabels'
import type { ApplicationStatus, ApplicationSummary } from '@/shared/types'

const REVIEW_STATUSES = new Set<ApplicationStatus>(['manual_review', 'documents_review_required'])
const SUCCESS_STATUSES = new Set<ApplicationStatus>([
  'approved',
  'offer_created',
  'offer_sent',
  'offer_accepted',
])
const CLOSED_STATUSES = new Set<ApplicationStatus>([
  'denied',
  'offer_declined',
  'cancelled',
  'expired',
])

function countBy(applications: ApplicationSummary[], statuses: Set<ApplicationStatus>): number {
  return applications.filter((application) => statuses.has(application.status)).length
}

export default function ApplicationsListPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['applications'],
    queryFn: () => apiFetch<ApplicationSummary[]>('/api/applications'),
  })

  return (
    <div className="page">
      <h1 className="page-title">Propostas</h1>

      {data && data.length > 0 && (
        <div className="stat-chips">
          <div className="stat-chip">
            <strong>{data.length}</strong>
            <span>No total</span>
          </div>
          <div className="stat-chip">
            <strong>{countBy(data, REVIEW_STATUSES)}</strong>
            <span>Aguardando revisão</span>
          </div>
          <div className="stat-chip">
            <strong>{countBy(data, SUCCESS_STATUSES)}</strong>
            <span>Aprovadas</span>
          </div>
          <div className="stat-chip">
            <strong>{countBy(data, CLOSED_STATUSES)}</strong>
            <span>Encerradas</span>
          </div>
        </div>
      )}

      {isLoading ? (
        <table className="applications-table skeleton-table" aria-label="Carregando propostas">
          <tbody>
            {[0, 1, 2, 3].map((row) => (
              <tr key={row}>
                <td>
                  <div className="skeleton" style={{ width: '60%' }} />
                </td>
                <td>
                  <div className="skeleton" style={{ width: '40%' }} />
                </td>
                <td>
                  <div className="skeleton" style={{ width: '50%' }} />
                </td>
                <td>
                  <div className="skeleton" style={{ width: '30%' }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : !data || data.length === 0 ? (
        <div className="empty-state">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M4 4h16v16H4z M8 9h8 M8 13h5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p>Nenhuma proposta ainda.</p>
          <Link to="/nova" className="button">
            Criar a primeira proposta
          </Link>
        </div>
      ) : (
        <table className="applications-table">
          <thead>
            <tr>
              <th>Veículo</th>
              <th>Valor solicitado</th>
              <th>Status</th>
              <th>Criada em</th>
            </tr>
          </thead>
          <tbody>
            {data.map((application) => (
              <tr key={application.id}>
                <td>
                  <Link to={`/propostas/${application.id}`}>
                    {application.vehicleMake} {application.vehicleModel} ({application.vehicleYear})
                  </Link>
                </td>
                <td>{formatCurrency(application.requestedAmount)}</td>
                <td>
                  <span className={`status-badge status-${application.status}`}>
                    {STATUS_LABELS[application.status]}
                  </span>
                </td>
                <td>{formatDate(application.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
