const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock }
  },
}))

import { extractDocument, ExtractionError } from './claude'

/**
 * Nunca chama a API real — o SDK é mockado inteiro. Cobre os quatro casos
 * que o plano da Fase 2 pede: limpo, baixa confiança, malformado, erro.
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

  it('lança ExtractionError quando o modelo não usa a ferramenta', async () => {
    createMock.mockResolvedValue({
      model: 'claude-opus-5',
      content: [{ type: 'text', text: 'não consigo ler essa imagem' }],
    })

    await expect(extractDocument('base64-fake', 'image/jpeg', 'rg')).rejects.toThrow(
      ExtractionError,
    )
  })

  it('lança ExtractionError quando a saída da ferramenta não bate com o schema esperado', async () => {
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
      ExtractionError,
    )
  })

  it('lança ExtractionError quando a chamada à API falha', async () => {
    createMock.mockRejectedValue(new Error('rede fora do ar'))

    await expect(extractDocument('base64-fake', 'image/jpeg', 'rg')).rejects.toThrow(
      ExtractionError,
    )
  })
})
