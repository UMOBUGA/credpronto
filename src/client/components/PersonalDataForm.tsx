import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/shared/lib/api'

interface Props {
  token: string
  onSubmitted: () => void
}

export function PersonalDataForm({ token, onSubmitted }: Props) {
  const [birthDate, setBirthDate] = useState('')
  const [street, setStreet] = useState('')
  const [number, setNumber] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')
  const [monthlyIncome, setMonthlyIncome] = useState('')
  const [consent, setConsent] = useState(false)
  const [consentBureauCheck, setConsentBureauCheck] = useState(true)
  const [consentAiNarrativeShare, setConsentAiNarrativeShare] = useState(true)

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/client/${token}/submit`, {
        method: 'POST',
        body: JSON.stringify({
          birthDate,
          address: { street, number, city, state, zip },
          monthlyIncomeDeclared: Number(monthlyIncome),
          consent: true,
          consentBureauCheck,
          consentAiNarrativeShare,
        }),
      }),
    onSuccess: onSubmitted,
  })

  return (
    <div className="client-card">
      <h2>Complete seus dados</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate()
        }}
      >
        <label>
          Data de nascimento
          <input
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            required
          />
        </label>
        <label>
          Rua
          <input value={street} onChange={(e) => setStreet(e.target.value)} required />
        </label>
        <label>
          Número
          <input value={number} onChange={(e) => setNumber(e.target.value)} required />
        </label>
        <label>
          Cidade
          <input value={city} onChange={(e) => setCity(e.target.value)} required />
        </label>
        <label>
          UF
          <input
            value={state}
            maxLength={2}
            onChange={(e) => setState(e.target.value.toUpperCase())}
            required
          />
        </label>
        <label>
          CEP
          <input value={zip} onChange={(e) => setZip(e.target.value)} required />
        </label>
        <label>
          Renda mensal declarada
          <input
            type="number"
            value={monthlyIncome}
            onChange={(e) => setMonthlyIncome(e.target.value)}
            required
          />
        </label>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            required
          />
          Autorizo o uso dos meus dados para análise de crédito, conforme a política de privacidade
          (obrigatório).
        </label>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={consentBureauCheck}
            onChange={(e) => setConsentBureauCheck(e.target.checked)}
          />
          Autorizo a consulta ao meu histórico de crédito (bureau) para esta análise.
        </label>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={consentAiNarrativeShare}
            onChange={(e) => setConsentAiNarrativeShare(e.target.checked)}
          />
          Autorizo receber uma explicação da decisão gerada por inteligência artificial.
        </label>
        <p className="hint-text">
          As duas últimas autorizações são opcionais e não afetam sua elegibilidade ao
          financiamento.
        </p>
        {mutation.isError && (
          <p className="form-error">Não foi possível enviar. Tente novamente.</p>
        )}
        <button type="submit" disabled={mutation.isPending || !consent}>
          {mutation.isPending ? 'Enviando…' : 'Enviar'}
        </button>
      </form>
    </div>
  )
}
