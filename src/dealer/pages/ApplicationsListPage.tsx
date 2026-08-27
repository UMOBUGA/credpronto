import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/shared/lib/api'
import { formatCurrency, formatDate } from '@/shared/lib/format'
import { STATUS_LABELS } from '@/shared/statusLabels'
import type { ApplicationSummary, ApplicationStatus } from '@/shared/types'

interface ApplicationsListResponse {
  items: ApplicationSummary[]
  page: number
  pageSize: number
  hasMore: boolean
  stats: { total: number; reviewing: number; approved: number; closed: number }
}

const SEARCH_DEBOUNCE_MS = 300

export default function ApplicationsListPage() {
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<ApplicationStatus | ''>('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  // Debounce só do texto digitado — status já é um <select>, não precisa.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Qualquer mudança de filtro invalida a página em que o dealer estava —
  // ficar na página 3 de um filtro novo quase sempre mostraria "vazio".
  useEffect(() => {
    setPage(1)
  }, [status, search])

  const params = new URLSearchParams({ page: String(page) })
  if (status) params.set('status', status)
  if (search) params.set('q', search)

  const { data, isLoading } = useQuery({
    queryKey: ['applications', page, status, search],
    queryFn: () => apiFetch<ApplicationsListResponse>(`/api/applications?${params.toString()}`),
  })
  const items = data?.items ?? []
  const isFiltering = Boolean(status || search)

  return (
    <div className="page">
      <h1 className="page-title">Propostas</h1>

      {data && data.stats.total > 0 && (
        <div className="stat-chips">
          <div className="stat-chip">
            <strong>{data.stats.total}</strong>
            <span>No total</span>
          </div>
          <div className="stat-chip">
            <strong>{data.stats.reviewing}</strong>
            <span>Aguardando revisão</span>
          </div>
          <div className="stat-chip">
            <strong>{data.stats.approved}</strong>
            <span>Aprovadas</span>
          </div>
          <div className="stat-chip">
            <strong>{data.stats.closed}</strong>
            <span>Encerradas</span>
          </div>
        </div>
      )}

      <div className="list-filters">
        <input
          type="search"
          placeholder="Buscar por marca, modelo ou placa"
          aria-label="Buscar propostas"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <select
          aria-label="Filtrar por status"
          value={status}
          onChange={(e) => setStatus(e.target.value as ApplicationStatus | '')}
        >
          <option value="">Todos os status</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

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
      ) : items.length === 0 ? (
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
          <p>
            {isFiltering
              ? 'Nenhuma proposta encontrada com esse filtro.'
              : page > 1
                ? 'Nenhuma proposta nesta página.'
                : 'Nenhuma proposta ainda.'}
          </p>
          {!isFiltering && (
            <Link to="/nova" className="button">
              Criar a primeira proposta
            </Link>
          )}
        </div>
      ) : (
        <>
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
              {items.map((application) => (
                <tr key={application.id}>
                  <td>
                    <Link to={`/propostas/${application.id}`}>
                      {application.vehicleMake} {application.vehicleModel} (
                      {application.vehicleYear})
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
          {(page > 1 || data?.hasMore) && (
            <div className="pagination">
              <button
                type="button"
                className="button-secondary"
                onClick={() => setPage((p) => p - 1)}
                disabled={page <= 1}
              >
                ← Anterior
              </button>
              <span className="hint-text">Página {page}</span>
              <button
                type="button"
                className="button-secondary"
                onClick={() => setPage((p) => p + 1)}
                disabled={!data?.hasMore}
              >
                Próxima →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
