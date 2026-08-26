import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiFetch } from '@/shared/lib/api'
import type { DealerUser } from '@/shared/types'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<DealerUser>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    onSuccess: (user) => {
      queryClient.setQueryData(['session'], { user })
    },
  })

  return (
    <div className="auth-page">
      <form
        className="auth-card"
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate()
        }}
      >
        <h1>credpronto</h1>
        <p className="auth-subtitle">Painel da loja</p>
        <label>
          E-mail
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Senha
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {mutation.isError && (
          <p className="form-error">
            {mutation.error instanceof ApiError && mutation.error.status === 401
              ? 'E-mail ou senha inválidos.'
              : 'Não foi possível entrar. Tente novamente.'}
          </p>
        )}
        <button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
