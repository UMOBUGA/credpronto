import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/shared/lib/api'
import { formatCurrency } from '@/shared/lib/format'

interface CreateResponse {
  id: string
  portalPath: string
}

interface FipeLookupResult {
  fipeValue: number | null
  fipeCode: string | null
  fipeBrand: string | null
  fipeModel: string | null
  fipeYear: string | null
}

interface FormState {
  fullName: string
  cpf: string
  phone: string
  email: string
  vehicleMake: string
  vehicleModel: string
  vehicleYear: number
  vehiclePrice: number
  vehiclePlate: string
  downPayment: number
  requestedAmount: number
  requestedTermMonths: number
}

const INITIAL_FORM: FormState = {
  fullName: '',
  cpf: '',
  phone: '',
  email: '',
  vehicleMake: '',
  vehicleModel: '',
  vehicleYear: new Date().getFullYear(),
  vehiclePrice: 0,
  vehiclePlate: '',
  downPayment: 0,
  requestedAmount: 0,
  requestedTermMonths: 36,
}

export default function NewApplicationPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [fipeResult, setFipeResult] = useState<FipeLookupResult | null>(null)

  const fipeLookup = useMutation({
    mutationFn: () => {
      const params = new URLSearchParams({
        make: form.vehicleMake,
        model: form.vehicleModel,
        year: String(form.vehicleYear),
      })
      return apiFetch<FipeLookupResult>(`/api/vehicles/fipe-lookup?${params.toString()}`)
    },
    onSuccess: setFipeResult,
  })

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<CreateResponse>('/api/applications', {
        method: 'POST',
        body: JSON.stringify({
          applicant: {
            fullName: form.fullName,
            cpf: form.cpf,
            phone: form.phone,
            email: form.email,
          },
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
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['applications'] })
      navigate(`/propostas/${created.id}`)
    },
  })

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function setVehicleField<K extends 'vehicleMake' | 'vehicleModel' | 'vehicleYear'>(
    key: K,
    value: FormState[K],
  ) {
    set(key, value)
    setFipeResult(null)
  }

  const canLookupFipe = Boolean(form.vehicleMake && form.vehicleModel && form.vehicleYear)
  const ltvRatio =
    fipeResult?.fipeValue && form.requestedAmount
      ? form.requestedAmount / fipeResult.fipeValue
      : null

  return (
    <div className="page">
      <Link to="/" className="back-link">
        ← Voltar para propostas
      </Link>
      <h1>Nova proposta</h1>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate()
        }}
      >
        <fieldset>
          <legend>Comprador</legend>
          <label>
            Nome completo
            <input
              value={form.fullName}
              onChange={(e) => set('fullName', e.target.value)}
              required
            />
          </label>
          <label>
            CPF
            <input value={form.cpf} onChange={(e) => set('cpf', e.target.value)} required />
          </label>
          <label>
            Telefone
            <input value={form.phone} onChange={(e) => set('phone', e.target.value)} required />
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
        </fieldset>
        <fieldset>
          <legend>Veículo e financiamento</legend>
          <label>
            Marca
            <input
              value={form.vehicleMake}
              onChange={(e) => setVehicleField('vehicleMake', e.target.value)}
              required
            />
          </label>
          <label>
            Modelo
            <input
              value={form.vehicleModel}
              onChange={(e) => setVehicleField('vehicleModel', e.target.value)}
              required
            />
          </label>
          <label>
            Ano
            <input
              type="number"
              value={form.vehicleYear}
              onChange={(e) => setVehicleField('vehicleYear', Number(e.target.value))}
              required
            />
          </label>
          <div className="fipe-lookup">
            <button
              type="button"
              className="button-secondary"
              onClick={() => fipeLookup.mutate()}
              disabled={!canLookupFipe || fipeLookup.isPending}
            >
              {fipeLookup.isPending ? 'Consultando…' : 'Consultar valor FIPE'}
            </button>
            {fipeLookup.isSuccess && (
              <p className="hint-text">
                {fipeResult?.fipeValue != null ? (
                  <>
                    Valor FIPE: {formatCurrency(fipeResult.fipeValue)}
                    {fipeResult.fipeBrand && fipeResult.fipeModel && (
                      <>
                        {' '}
                        ({fipeResult.fipeBrand} {fipeResult.fipeModel})
                      </>
                    )}
                    {ltvRatio != null && (
                      <>
                        {' '}
                        — valor solicitado corresponde a {(ltvRatio * 100).toFixed(0)}% do valor
                        FIPE
                      </>
                    )}
                  </>
                ) : (
                  'Valor FIPE não encontrado para essa marca/modelo/ano — a loja pode seguir com o valor digitado.'
                )}
              </p>
            )}
            {fipeLookup.isError && (
              <p className="hint-text">Não foi possível consultar a FIPE agora.</p>
            )}
          </div>
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
        </fieldset>
        {mutation.isError && <p className="form-error">Não foi possível criar a proposta.</p>}
        <button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Criando…' : 'Criar e gerar link'}
        </button>
      </form>
    </div>
  )
}
