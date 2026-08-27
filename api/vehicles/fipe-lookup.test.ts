import fipeLookupHandler from './fipe-lookup'
import { resetFipeCache } from '../_lib/fipe'
import { getDb } from '../_lib/db'
import { seedDealerUser } from '../_lib/testFixtures'
import { createSessionToken, SESSION_COOKIE_NAME } from '../_lib/auth'
import { mockReq, mockRes } from '../_lib/testHttp'

const BRANDS = [{ nome: 'Fiat', valor: '21' }]
const MODELS = [{ modelo: 'Argo', valor: '7736' }]
const YEARS = [{ nome: '2022 Gasolina', valor: '2022-1' }]
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
 * `fetch` sempre mockado — mesmo padrão de `fipe.test.ts`, nunca bate na
 * BrasilAPI de verdade em CI. Este arquivo cobre só a camada HTTP nova
 * (auth + parsing de query string); a cadeia da FIPE em si já é testada em
 * `api/_lib/fipe.test.ts`.
 */
describe('GET /api/vehicles/fipe-lookup', () => {
  beforeEach(() => {
    resetFipeCache()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('devolve o valor FIPE pro dealer autenticado', async () => {
    vi.stubGlobal('fetch', chainFetchMock())
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`

    const res = mockRes()
    await fipeLookupHandler(
      mockReq('/api/vehicles/fipe-lookup?make=Fiat&model=Argo&year=2022', { headers: { cookie } }),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      fipeValue: 68451,
      fipeCode: '001004-9',
      fipeBrand: 'Fiat',
      fipeModel: 'Argo',
      fipeYear: '2022',
    })
  })

  it('devolve tudo null sem quebrar quando não há correspondência', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(BRANDS)))
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`

    const res = mockRes()
    await fipeLookupHandler(
      mockReq('/api/vehicles/fipe-lookup?make=MarcaInexistente&model=X&year=2022', {
        headers: { cookie },
      }),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect((res.body as { fipeValue: number | null }).fipeValue).toBeNull()
  })

  it('sem sessão recebe 401', async () => {
    const res = mockRes()
    await fipeLookupHandler(
      mockReq('/api/vehicles/fipe-lookup?make=Fiat&model=Argo&year=2022'),
      res,
    )
    expect(res.statusCode).toBe(401)
  })

  it('query inválida recebe 400', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`

    const res = mockRes()
    await fipeLookupHandler(
      mockReq('/api/vehicles/fipe-lookup?make=Fiat', { headers: { cookie } }),
      res,
    )
    expect(res.statusCode).toBe(400)
  })
})
