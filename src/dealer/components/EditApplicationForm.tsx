import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/shared/lib/api'
import type { ApplicationDetail } from '@/shared/types'

interface Props {
  application: ApplicationDetail
  onSaved: () => void
}

interface FormState {
  vehicleMake: string
  vehicleModel: string
  vehicleYear: number
  vehiclePrice: number
  vehiclePlate: string
  downPayment: number
  requestedAmount: number
  requestedTermMonths: number
}

/**
 * Só é montado quando `EDITABLE_STATUSES.has(application.status)` (ver
 * `ApplicationDetailPage.tsx`) — o estado inicial vem de `application` via
 * inicializador preguiçoso do `useState`, então não precisa de `useEffect`
 * pra sincronizar (o componente remonta quando a proposta muda, já que a
 * página inteira troca de rota por `id`).
 */
export function EditApplicationForm({ application, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(() => ({
    vehicleMake: application.vehicleMake,
    vehicleModel: application.vehicleModel,
    vehicleYear: application.vehicleYear,
    vehiclePrice: application.vehiclePrice,
    vehiclePlate: application.vehiclePlate,
    downPayment: application.downPayment,
    requestedAmount: application.requestedAmount,
    requestedTermMonths: application.requestedTermMonths,
  }))

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/applications/${application.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          vehicleMake: form.vehicleMake,
          vehicleModel: form.vehicleModel,
          vehicleYear: Number(form.vehicleYear),
          vehiclePrice: Number(form.vehiclePrice),
          vehiclePlate: form.vehiclePlate,
          downPayment: Number(form.downPayment),
          requestedAmount: Number(form.requestedAmount),
          requestedTermMonths: Number(form.requestedTermMonths),
        }),
      }),
    onSuccess: onSaved,
  })

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <section className="detail-section">
      <h2>Editar proposta</h2>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate()
        }}
      >
        <label>
          Marca
          <input
            value={form.vehicleMake}
            onChange={(e) => set('vehicleMake', e.target.value)}
            required
          />
        </label>
        <label>
          Modelo
          <input
            value={form.vehicleModel}
            onChange={(e) => set('vehicleModel', e.target.value)}
            required
          />
        </label>
        <label>
          Ano
          <input
            type="number"
            value={form.vehicleYear}
            onChange={(e) => set('vehicleYear', Number(e.target.value))}
            required
          />
        </label>
        <label>
          Preço do veículo
          <input
            type="number"
            value={form.vehiclePrice}
            onChange={(e) => set('vehiclePrice', Number(e.target.value))}
            required
          />
        </label>
        <label>
          Placa
          <input
            value={form.vehiclePlate}
            onChange={(e) => set('vehiclePlate', e.target.value.toUpperCase())}
            required
          />
        </label>
        <label>
          Entrada
          <input
            type="number"
            value={form.downPayment}
            onChange={(e) => set('downPayment', Number(e.target.value))}
          />
        </label>
        <label>
          Valor solicitado
          <input
            type="number"
            value={form.requestedAmount}
            onChange={(e) => set('requestedAmount', Number(e.target.value))}
            required
          />
        </label>
        <label>
          Prazo (meses)
          <input
            type="number"
            value={form.requestedTermMonths}
            onChange={(e) => set('requestedTermMonths', Number(e.target.value))}
            required
          />
        </label>
        {mutation.isError && (
          <p className="form-error">Não foi possível salvar as alterações. Tente novamente.</p>
        )}
        {mutation.isSuccess && <p className="hint-text">Alterações salvas.</p>}
        <button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Salvando…' : 'Salvar alterações'}
        </button>
      </form>
    </section>
  )
}
