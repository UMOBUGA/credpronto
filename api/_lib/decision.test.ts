import { decide, type DecisionInput } from './decision'

const CLEAN_INPUT: DecisionInput = {
  bureauScore: 800,
  hasBureauRestriction: false,
  requestedAmount: 20000,
  monthlyIncomeDeclared: 10000,
  requestedTermMonths: 48,
  vehicleRestrictionFound: false,
  fipeValue: 60000,
  antifraudRiskScore: 0,
  antifraudFlags: [],
}

describe('decide', () => {
  it('aprova quando tudo está limpo', () => {
    const result = decide(CLEAN_INPUT)
    expect(result.outcome).toBe('approved')
  })

  it('nega automaticamente quando o veículo tem restrição — mesmo com bureau perfeito', () => {
    const result = decide({ ...CLEAN_INPUT, vehicleRestrictionFound: true })
    expect(result.outcome).toBe('denied')
  })

  it('nega quando o bureau reporta restrição', () => {
    const result = decide({ ...CLEAN_INPUT, hasBureauRestriction: true })
    expect(result.outcome).toBe('denied')
  })

  it('força manual_review quando o CPF extraído diverge do declarado — nunca aprova sozinho', () => {
    const result = decide({ ...CLEAN_INPUT, antifraudFlags: ['cpf_mismatch'] })
    expect(result.outcome).toBe('manual_review')
  })

  it('força manual_review quando o CPF aparece na base de fraude simulada', () => {
    const result = decide({ ...CLEAN_INPUT, antifraudFlags: ['known_fraud_list'] })
    expect(result.outcome).toBe('manual_review')
  })

  it('não bloqueia por uma flag de antifraude leve (name_mismatch sozinho)', () => {
    const result = decide({ ...CLEAN_INPUT, antifraudFlags: ['name_mismatch'] })
    expect(result.outcome).toBe('approved')
  })

  it('não aprova automaticamente quando o LTV é muito alto, mas também não nega sozinho', () => {
    const result = decide({ ...CLEAN_INPUT, requestedAmount: 65000, fipeValue: 50000 })
    expect(result.outcome).toBe('manual_review')
  })

  it('nega quando o score do bureau está muito baixo', () => {
    const result = decide({ ...CLEAN_INPUT, bureauScore: 300 })
    expect(result.outcome).toBe('denied')
  })

  it('vai para manual_review na zona intermediária', () => {
    const result = decide({ ...CLEAN_INPUT, bureauScore: 600, requestedAmount: 40000 })
    expect(result.outcome).toBe('manual_review')
  })

  it('trata fipeValue nulo como "sem dado" — não quebra o cálculo de LTV', () => {
    const result = decide({ ...CLEAN_INPUT, fipeValue: null })
    expect(result.factors.loanToValue).toBeNull()
    expect(result.outcome).toBe('approved')
  })
})
