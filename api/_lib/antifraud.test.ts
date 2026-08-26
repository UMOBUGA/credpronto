import { checkAntifraud, type AntifraudInput } from './antifraud'

const BASE_INPUT: AntifraudInput = {
  declaredCpf: '39053344705',
  declaredFullName: 'Fulano de Teste',
  extractedCpf: '39053344705',
  extractedFullName: 'Fulano de Teste',
  birthDate: '1990-01-01',
}

describe('checkAntifraud', () => {
  const originalScenario = process.env.MOCK_ANTIFRAUD_SCENARIO

  beforeEach(() => {
    process.env.MOCK_ANTIFRAUD_SCENARIO = 'clean'
  })
  afterAll(() => {
    process.env.MOCK_ANTIFRAUD_SCENARIO = originalScenario
  })

  it('não levanta flag quando tudo bate', () => {
    const result = checkAntifraud(BASE_INPUT)
    expect(result.flags).toEqual([])
    expect(result.riskScore).toBe(0)
  })

  it('detecta CPF divergente entre declarado e extraído do documento', () => {
    const result = checkAntifraud({ ...BASE_INPUT, extractedCpf: '00000000000' })
    expect(result.flags).toContain('cpf_mismatch')
    expect(result.riskScore).toBeGreaterThan(0)
  })

  it('detecta nome divergente', () => {
    const result = checkAntifraud({
      ...BASE_INPUT,
      declaredFullName: 'José da Silva',
      extractedFullName: 'Maria Souza',
    })
    expect(result.flags).toContain('name_mismatch')
  })

  it('não marca name_mismatch por diferença só de acento/caixa', () => {
    const result = checkAntifraud({
      ...BASE_INPUT,
      declaredFullName: 'José da Silva',
      extractedFullName: 'JOSE DA SILVA',
    })
    expect(result.flags).not.toContain('name_mismatch')
  })

  it('detecta menor de idade a partir da data de nascimento', () => {
    const recentYear = new Date().getFullYear() - 10
    const result = checkAntifraud({ ...BASE_INPUT, birthDate: `${recentYear}-01-01` })
    expect(result.flags).toContain('underage')
  })

  it('não avalia idade quando não há data de nascimento ainda', () => {
    const result = checkAntifraud({ ...BASE_INPUT, birthDate: null })
    expect(result.flags).not.toContain('underage')
  })

  it('respeita o cenário forçado da base de fraude simulada', () => {
    process.env.MOCK_ANTIFRAUD_SCENARIO = 'flagged'
    const result = checkAntifraud(BASE_INPUT)
    expect(result.flags).toContain('known_fraud_list')
  })

  it('não avalia CPF/nome extraído quando ainda não há documento aceito', () => {
    const result = checkAntifraud({ ...BASE_INPUT, extractedCpf: null, extractedFullName: null })
    expect(result.flags).toEqual([])
  })
})
