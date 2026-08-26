import { lookupFipeValue, resetFipeCache } from './fipe'

const BRANDS = [
  { nome: 'Fiat', valor: '21' },
  { nome: 'Volkswagen', valor: '59' },
]
const MODELS = [
  { modelo: 'Argo', valor: '7736' },
  { modelo: 'Uno', valor: '5711' },
]
const YEARS = [
  { nome: '2022 Gasolina', valor: '2022-1' },
  { nome: '2021 Gasolina', valor: '2021-1' },
]
const DETAILS = {
  valor: 'R$ 68.451,00',
  marca: 'Fiat',
  modelo: 'Argo',
  anoModelo: 2022,
  codigoFipe: '001004-9',
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response
}

function chainFetchMock() {
  return vi.fn((url: string) => {
    if (url.includes('/marcas/')) return Promise.resolve(jsonResponse(BRANDS))
    if (url.includes('/veiculos/')) return Promise.resolve(jsonResponse(MODELS))
    if (url.includes('/anos/')) return Promise.resolve(jsonResponse(YEARS))
    if (url.includes('/detalhes/')) return Promise.resolve(jsonResponse(DETAILS))
    throw new Error(`URL inesperada: ${url}`)
  })
}

/**
 * `fetch` é sempre mockado — a cadeia da BrasilAPI (confirmada lendo o
 * código-fonte dela, ver o plano) nunca é chamada de verdade em CI, mesmo
 * sendo gratuita e sem chave.
 */
describe('lookupFipeValue', () => {
  beforeEach(() => {
    resetFipeCache()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolve marca/modelo/ano digitados como texto livre e devolve o valor real', async () => {
    const fetchMock = chainFetchMock()
    vi.stubGlobal('fetch', fetchMock)

    const result = await lookupFipeValue('fiat', 'argo', 2022)

    expect(result).toEqual({
      fipeValue: 68451,
      fipeCode: '001004-9',
      fipeBrand: 'Fiat',
      fipeModel: 'Argo',
      fipeYear: '2022',
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('cacheia marcas e modelos entre chamadas (mudam raramente)', async () => {
    const fetchMock = chainFetchMock()
    vi.stubGlobal('fetch', fetchMock)

    await lookupFipeValue('fiat', 'argo', 2022)
    await lookupFipeValue('fiat', 'argo', 2021)

    const brandCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/marcas/'))
    const modelCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/veiculos/'))
    expect(brandCalls).toHaveLength(1)
    expect(modelCalls).toHaveLength(1)
  })

  it('devolve tudo null quando a marca digitada não tem correspondência', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(BRANDS)))

    const result = await lookupFipeValue('MarcaTotalmenteInexistente', 'Modelo', 2022)

    expect(result.fipeValue).toBeNull()
  })

  it('devolve tudo null quando a API responde com erro', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response))

    const result = await lookupFipeValue('Fiat', 'Argo', 2022)

    expect(result).toEqual({
      fipeValue: null,
      fipeCode: null,
      fipeBrand: null,
      fipeModel: null,
      fipeYear: null,
    })
  })

  it('devolve tudo null quando a rede falha', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const result = await lookupFipeValue('Fiat', 'Argo', 2022)

    expect(result.fipeValue).toBeNull()
  })
})
