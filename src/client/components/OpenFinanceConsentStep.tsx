import { useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/shared/lib/api'

interface Props {
  token: string
  onDecided: () => void
}

/**
 * Simulação: não existe um banco de sandbox real pra redirecionar o
 * cliente — participar do Open Finance Brasil, mesmo em sandbox, exige a
 * instituição ser autorizada pelo Banco Central (ver README). A tela é
 * honesta sobre isso em vez de fingir uma integração real.
 */
export function OpenFinanceConsentStep({ token, onDecided }: Props) {
  const mutation = useMutation({
    mutationFn: (decision: 'authorize' | 'deny') =>
      apiFetch(`/api/client/${token}/openfinance`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      }),
    onSuccess: onDecided,
  })

  return (
    <div className="client-card">
      <h2>Autorizar Open Finance</h2>
      <p>
        Compartilhar seus dados financeiros pode agilizar a análise. É opcional — não autorizar não
        prejudica sua proposta.
      </p>
      <p className="hint-text">
        Simulação de demonstração: este projeto não tem como se conectar a um banco de verdade
        (participar do Open Finance exige autorização do Banco Central).
      </p>
      {mutation.isError && (
        <p className="form-error">Não foi possível processar. Tente novamente.</p>
      )}
      <div className="actions">
        <button onClick={() => mutation.mutate('authorize')} disabled={mutation.isPending}>
          {mutation.isPending ? 'Processando…' : 'Autorizar'}
        </button>
        <button
          className="button-secondary"
          onClick={() => mutation.mutate('deny')}
          disabled={mutation.isPending}
        >
          Não autorizar
        </button>
      </div>
    </div>
  )
}
