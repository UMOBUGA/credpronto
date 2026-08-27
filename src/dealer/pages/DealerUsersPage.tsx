import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiFetch } from '@/shared/lib/api'
import { formatDate } from '@/shared/lib/format'
import type { DealerUser, DealerUserManagementEntry } from '@/shared/types'
import { useSession } from '../hooks/useSession'

const ROLE_LABELS: Record<DealerUser['role'], string> = {
  admin: 'Admin',
  manager: 'Gerente',
  analyst: 'Analista',
}
const ROLE_OPTIONS = Object.entries(ROLE_LABELS) as [DealerUser['role'], string][]

interface FormState {
  name: string
  email: string
  password: string
  role: DealerUser['role']
}

const INITIAL_FORM: FormState = { name: '', email: '', password: '', role: 'analyst' }

/**
 * Restrita a `admin` — a rota em `App.tsx` e o item de menu em
 * `DealerLayout.tsx` já filtram por papel, mas o backend (`api/dealers/*`,
 * via `requireDealerRole`) é a fonte de verdade: um `manager`/`analyst` que
 * chegasse aqui de outro jeito receberia 403 em toda chamada.
 */
export default function DealerUsersPage() {
  const { data: session } = useSession()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(INITIAL_FORM)

  const queryKey = ['dealer-users']
  const { data: users, isLoading } = useQuery({
    queryKey,
    queryFn: () => apiFetch<DealerUserManagementEntry[]>('/api/dealers'),
    // Evita disparar a chamada (e o 403 esperado dela) antes do guard de
    // role abaixo redirecionar — a página monta e os hooks rodam antes de
    // qualquer `return` condicional, então sem isto a requisição sairia de
    // qualquer forma para quem não é admin.
    enabled: session?.user?.role === 'admin',
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey })

  const createUser = useMutation({
    mutationFn: () =>
      apiFetch('/api/dealers', {
        method: 'POST',
        body: JSON.stringify(form),
      }),
    onSuccess: () => {
      setForm(INITIAL_FORM)
      invalidate()
    },
  })

  const updateUser = useMutation({
    mutationFn: (params: { id: string; role?: DealerUser['role']; disabled?: boolean }) =>
      apiFetch(`/api/dealers/${params.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: params.role, disabled: params.disabled }),
      }),
    onSuccess: invalidate,
  })

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  // A rota some do menu pra quem não é admin (DealerLayout.tsx), mas
  // navegação direta pela URL não é bloqueada por padrão — o backend já
  // recusa com 403 (requireDealerRole em api/dealers/*), isto só evita
  // mostrar uma tela quebrada de erros de permissão antes de redirecionar.
  if (session?.user && session.user.role !== 'admin') {
    return <Navigate to="/" replace />
  }

  return (
    <div className="page">
      <Link to="/" className="back-link">
        ← Voltar para propostas
      </Link>
      <h1 className="page-title">Usuários da loja</h1>

      <section className="detail-section">
        <h2>Novo usuário</h2>
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault()
            createUser.mutate()
          }}
        >
          <fieldset>
            <legend>Dados de acesso</legend>
            <label>
              Nome completo
              <input value={form.name} onChange={(e) => set('name', e.target.value)} required />
            </label>
            <label>
              E-mail
              <input
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                required
              />
            </label>
            <label>
              Senha inicial
              <input
                type="password"
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
                minLength={8}
                required
              />
            </label>
            <label>
              Papel
              <select
                value={form.role}
                onChange={(e) => set('role', e.target.value as DealerUser['role'])}
              >
                {ROLE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
          {createUser.isError && (
            <p className="form-error">
              {createUser.error instanceof ApiError && createUser.error.status === 409
                ? 'Já existe um usuário com esse e-mail.'
                : 'Não foi possível criar o usuário — confira os dados (senha com pelo menos 8 caracteres).'}
            </p>
          )}
          <button type="submit" disabled={createUser.isPending}>
            {createUser.isPending ? 'Criando…' : 'Criar usuário'}
          </button>
        </form>
      </section>

      <section className="detail-section">
        <h2>Usuários</h2>
        {isLoading ? (
          <p className="hint-text">Carregando…</p>
        ) : (
          <table className="applications-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Papel</th>
                <th>Status</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {users?.map((user) => {
                const isSelf = user.id === session?.user?.id
                return (
                  <tr key={user.id}>
                    <td>{user.name}</td>
                    <td>{user.email}</td>
                    <td>
                      <select
                        aria-label={`Papel de ${user.name}`}
                        value={user.role}
                        disabled={updateUser.isPending}
                        onChange={(e) =>
                          updateUser.mutate({
                            id: user.id,
                            role: e.target.value as DealerUser['role'],
                          })
                        }
                      >
                        {ROLE_OPTIONS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {user.disabledAt ? `Desativado em ${formatDate(user.disabledAt)}` : 'Ativo'}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="button-secondary"
                        disabled={updateUser.isPending || (isSelf && !user.disabledAt)}
                        title={
                          isSelf && !user.disabledAt
                            ? 'Você não pode desativar sua própria conta'
                            : undefined
                        }
                        onClick={() =>
                          updateUser.mutate({ id: user.id, disabled: !user.disabledAt })
                        }
                      >
                        {user.disabledAt ? 'Reativar' : 'Desativar'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {updateUser.isError && (
          <p className="form-error">Não foi possível atualizar o usuário. Tente novamente.</p>
        )}
      </section>
    </div>
  )
}
