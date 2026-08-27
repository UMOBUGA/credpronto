import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/shared/lib/api'
import { formatCurrency, formatDate } from '@/shared/lib/format'
import { STATUS_LABELS } from '@/shared/statusLabels'
import type { ApplicationSummary } from '@/shared/types'

export default function ApplicationsListPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['applications'],
    queryFn: () => apiFetch<ApplicationSummary[]>('/api/applications'),
  })

  return (
    <div className="page">
      <h1 className="page-title">Propostas</h1>

      {isLoading ? (
        <p>Carregando propostas…</p>
      ) : !data || data.length === 0 ? (
        <p>Nenhuma proposta ainda.</p>
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
