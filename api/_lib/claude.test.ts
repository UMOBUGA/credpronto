const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock }
  },
}))

import { ClaudeToolCallError, extractDocument, generateNarrative } from './claude'
import type { DecisionResult } from './decision'

const SAMPLE_FACTORS: DecisionResult['factors'] = {
  bureauScore: 800,
  hasBureauRestriction: false,
  requestedAmount: 20000,
  monthlyIncomeDeclared: 10000,
  requestedTermMonths: 48,
  vehicleRestrictionFound: false,
  fipeValue: 60000,
  antifraudRiskScore: 0,
  antifraudFlags: [],
  openfinanceVerified: false,
  openfinanceIncomeEstimate: null,
  debtToIncome: 0.05,
  loanToValue: 0.33,
}

/**
 * Nunca chama a API real — o SDK é mockado inteiro. Cobre os quatro casos
 * que o plano pede pra cada ponto de integração: limpo, baixa
 * confiança/conteúdo válido, malformado, erro.
 */
describe('extractDocument', () => {
  beforeEach(() => {
    createMock.mockReset()
  })

  it('retorna os campos quando a extração é limpa', async () => {
    createMock.mockResolvedValue({
      model: 'claude-opus-5',
      content: [
        {
          type: 'tool_use',
          id: 't1',
          name: 'extract_document_fields',
          input: { fields: { nome: 'Fulano', cpf: '39053344705' }, confidence: 0.95, issues: [] },
        },
      ],
    })

    const result = await extractDocument('base64-fake', 'image/jpeg', 'rg')

    expect(result.fields).toEqual({ nome: 'Fulano', cpf: '39053344705' })
    expect(result.confidence).toBe(0.95)
    expect(result.modelUsed).toBe('claude-opus-5')
  })

  it('retorna confiança baixa e issues sem lançar — quem decide o que fazer é o pipeline, não este módulo', async () => {
    createMock.mockResolvedValue({
      model: 'claude-opus-5',
      content: [
        {
          type: 'tool_use',
          id: 't2',
          name: 'extract_document_fields',
          input: { fields: {}, confidence: 0.2, issues: ['imagem borrada'] },
        },
      ],
    })

    const result = await extractDocument('base64-fake', 'image/jpeg', 'rg')

    expect(result.confidence).toBe(0.2)
    expect(result.issues).toEqual(['imagem borrada'])
  })

  it('lança ClaudeToolCallError quando o modelo não usa a ferramenta', async () => {
    createMock.mockResolvedValue({
      model: 'claude-opus-5',
      content: [{ type: 'text', text: 'não consigo ler essa imagem' }],
    })

    await expect(extractDocument('base64-fake', 'image/jpeg', 'rg')).rejects.toThrow(
      ClaudeToolCallError,
    )
  })

  it('lança ClaudeToolCallError quando a saída da ferramenta não bate com o schema esperado', async () => {
    createMock.mockResolvedValue({
      model: 'claude-opus-5',
      content: [
        {
          type: 'tool_use',
          id: 't3',
          name: 'extract_document_fields',
          input: { fields: 'isso deveria ser um objeto', confidence: 'alta' },
        },
      ],
    })

    await expect(extractDocument('base64-fake', 'image/jpeg', 'rg')).rejects.toThrow(
      ClaudeToolCallError,
    )
  })

  it('lança ClaudeToolCallError quando a chamada à API falha', async () => {
    createMock.mockRejectedValue(new Error('rede fora do ar'))

    await expect(extractDocument('base64-fake', 'image/jpeg', 'rg')).rejects.toThrow(
      ClaudeToolCallError,
    )
  })
})

describe('generateNarrative', () => {
  beforeEach(() => {
    createMock.mockReset()
  })

  it('retorna as duas versões do parecer quando a resposta é limpa', async () => {
    createMock.mockResolvedValue({
      model: 'claude-opus-5',
      content: [
        {
          type: 'tool_use',
          id: 'n1',
          name: 'write_risk_narrative',
          input: {
            dealerNarrative: 'Score alto, DTI baixo, sem restrições — aprovação dentro da regra.',
            applicantNarrative:
              'Sua proposta foi aprovada! Em breve enviaremos os próximos passos.',
          },
        },
      ],
    })

    const result = await generateNarrative(SAMPLE_FACTORS, 'approved')

    expect(result.dealerNarrative).toContain('Score alto')
    expect(result.applicantNarrative).toContain('aprovada')
  })

  it('lança ClaudeToolCallError quando o modelo não usa a ferramenta', async () => {
    createMock.mockResolvedValue({
      model: 'claude-opus-5',
      content: [{ type: 'text', text: 'aqui está o parecer em texto livre...' }],
    })

    await expect(generateNarrative(SAMPLE_FACTORS, 'approved')).rejects.toThrow(ClaudeToolCallError)
  })

  it('lança ClaudeToolCallError quando a saída não bate com o schema esperado', async () => {
    createMock.mockResolvedValue({
      model: 'claude-opus-5',
      content: [
        {
          type: 'tool_use',
          id: 'n2',
          name: 'write_risk_narrative',
          input: { dealerNarrative: '' },
        },
      ],
    })

    await expect(generateNarrative(SAMPLE_FACTORS, 'denied')).rejects.toThrow(ClaudeToolCallError)
  })

  it('lança ClaudeToolCallError quando a chamada à API falha', async () => {
    createMock.mockRejectedValue(new Error('rede fora do ar'))

    await expect(generateNarrative(SAMPLE_FACTORS, 'manual_review')).rejects.toThrow(
      ClaudeToolCallError,
    )
  })
})
