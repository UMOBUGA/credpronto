import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/shared/lib/api'
import { formatCurrency, formatDate } from '@/shared/lib/format'
import { STATUS_LABELS } from '@/shared/statusLabels'
import type { ApplicationSummary, DealerUser } from '@/shared/types'

export default function ApplicationsListPage({ user }: { user: DealerUser }) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['applications'],
    queryFn: () => apiFetch<ApplicationSummary[]>('/api/applications'),
  })

  async function logout() {
    await apiFetch('/api/auth/logout', { method: 'POST' })
    queryClient.setQueryData(['session'], { user: null })
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>credpronto</h1>
          <p>{user.name}</p>
        </div>
        <div className="page-actions">
          <Link to="/nova" className="button">
            Nova proposta
          </Link>
          <button className="button-secondary" onClick={() => void logout()}>
            Sair
          </button>
        </div>
      </header>

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
