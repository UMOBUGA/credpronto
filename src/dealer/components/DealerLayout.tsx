import { Link, Outlet } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/shared/lib/api'
import type { DealerUser } from '@/shared/types'

interface Props {
  user: DealerUser
}

/**
 * Casca persistente de todas as rotas autenticadas do dealer (`App.tsx`
 * monta isto como rota pai com `<Outlet/>`). Antes só `ApplicationsListPage`
 * tinha cabeçalho próprio — `NewApplicationPage`/`ApplicationDetailPage`
 * não tinham nenhum, então depois de criar uma proposta o usuário caía numa
 * tela sem link de volta. Centralizar aqui garante que toda rota do dealer
 * sempre tem um jeito de voltar pra fila de propostas.
 */
export function DealerLayout({ user }: Props) {
  const queryClient = useQueryClient()

  const logout = useMutation({
    mutationFn: () => apiFetch('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => queryClient.setQueryData(['session'], { user: null }),
  })

  return (
    <div className="dealer-shell">
      <div className="dealer-topbar">
        <header className="page-header">
          <div>
            <Link to="/" className="brand-link">
              <h1>credpronto</h1>
            </Link>
            <p>{user.name}</p>
          </div>
          <div className="page-actions">
            <Link to="/nova" className="button">
              Nova proposta
            </Link>
            <button
              className="button-secondary"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
            >
              Sair
            </button>
          </div>
        </header>
      </div>
      <Outlet />
    </div>
  )
}
