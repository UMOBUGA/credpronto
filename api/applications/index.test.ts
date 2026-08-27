import applicationsHandler from './index'
import { getDb } from '../_lib/db'
import { seedApplicant, seedApplication, seedDealerUser } from '../_lib/testFixtures'
import { transition } from '../_lib/stateMachine'
import { createSessionToken, SESSION_COOKIE_NAME } from '../_lib/auth'
import { mockReq, mockRes } from '../_lib/testHttp'

/**
 * `applications/flow.test.ts` já cobre o POST (criação) ponta a ponta — este
 * arquivo cobre só o GET (listagem), que ganhou paginação e estatísticas
 * agregadas na Fase 12.
 */
describe('GET /api/applications — paginação e estatísticas (Fase 12)', () => {
  it('pagina por offset e devolve hasMore corretamente', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`

    // PAGE_SIZE é 25 — cria 27 pra forçar duas páginas.
    for (let i = 0; i < 27; i++) {
      const applicant = await seedApplicant(db)
      await seedApplication(db, { applicantId: applicant.id, dealerUserId: dealer.id })
    }

    const page1 = mockRes()
    await applicationsHandler(mockReq('/api/applications?page=1', { headers: { cookie } }), page1)
    const body1 = page1.body as { items: unknown[]; page: number; hasMore: boolean }
    expect(body1.items).toHaveLength(25)
    expect(body1.page).toBe(1)
    expect(body1.hasMore).toBe(true)

    const page2 = mockRes()
    await applicationsHandler(mockReq('/api/applications?page=2', { headers: { cookie } }), page2)
    const body2 = page2.body as { items: unknown[]; page: number; hasMore: boolean }
    expect(body2.items).toHaveLength(2)
    expect(body2.page).toBe(2)
    expect(body2.hasMore).toBe(false)
  })

  it('estatísticas refletem a tabela inteira, não só a página carregada', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`
    const actor = { actorType: 'dealer_user' as const, actorId: dealer.id }

    // Delta em vez de valor absoluto: este arquivo de teste compartilha um
    // único banco em memória entre os `it()`, e o teste de paginação acima
    // já insere 27 propostas nele.
    const before = mockRes()
    await applicationsHandler(mockReq('/api/applications', { headers: { cookie } }), before)
    const statsBefore = (before.body as { stats: { total: number; closed: number } }).stats

    const applicantA = await seedApplicant(db)
    const appA = await seedApplication(db, { applicantId: applicantA.id, dealerUserId: dealer.id })
    await transition(db, appA.id, 'link_sent', actor)
    await transition(db, appA.id, 'cancelled', actor)

    const applicantB = await seedApplicant(db)
    const appB = await seedApplication(db, { applicantId: applicantB.id, dealerUserId: dealer.id })
    await transition(db, appB.id, 'link_sent', actor)

    const res = mockRes()
    await applicationsHandler(mockReq('/api/applications', { headers: { cookie } }), res)
    const body = res.body as {
      stats: { total: number; reviewing: number; approved: number; closed: number }
    }
    expect(body.stats.total).toBe(statsBefore.total + 2)
    expect(body.stats.closed).toBe(statsBefore.closed + 1)
  })
})

describe('GET /api/applications — busca e filtro (Fase 15)', () => {
  it('filtra por status exato, sem afetar as estatísticas', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`
    const actor = { actorType: 'dealer_user' as const, actorId: dealer.id }

    const applicantA = await seedApplicant(db)
    const appA = await seedApplication(db, { applicantId: applicantA.id, dealerUserId: dealer.id })
    await transition(db, appA.id, 'link_sent', actor)
    await transition(db, appA.id, 'cancelled', actor)

    const applicantB = await seedApplicant(db)
    await seedApplication(db, { applicantId: applicantB.id, dealerUserId: dealer.id }) // fica em draft

    const res = mockRes()
    await applicationsHandler(
      mockReq('/api/applications?status=cancelled', { headers: { cookie } }),
      res,
    )
    const body = res.body as {
      items: { id: string; status: string }[]
      stats: { total: number }
    }
    expect(body.items.length).toBeGreaterThan(0)
    expect(body.items.every((item) => item.status === 'cancelled')).toBe(true)
    expect(body.items.some((item) => item.id === appA.id)).toBe(true)
    // Estatísticas continuam somando a tabela inteira, não só o filtro.
    expect(body.stats.total).toBeGreaterThan(body.items.length)
  })

  it('busca por marca/modelo/placa (case-insensitive, parcial)', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`

    const applicant = await seedApplicant(db)
    const target = await seedApplication(db, {
      applicantId: applicant.id,
      dealerUserId: dealer.id,
      vehicleMake: 'Toyota',
      vehicleModel: 'Corolla Busca15',
      vehiclePlate: 'BSC1A15',
    })

    const byModel = mockRes()
    await applicationsHandler(
      mockReq('/api/applications?q=corolla busca15', { headers: { cookie } }),
      byModel,
    )
    const bodyByModel = byModel.body as { items: { id: string }[] }
    expect(bodyByModel.items.map((i) => i.id)).toContain(target.id)

    const byPlate = mockRes()
    await applicationsHandler(
      mockReq('/api/applications?q=BSC1A15', { headers: { cookie } }),
      byPlate,
    )
    const bodyByPlate = byPlate.body as { items: { id: string }[] }
    expect(bodyByPlate.items.map((i) => i.id)).toContain(target.id)
  })

  it('combina status e busca, e devolve lista vazia quando nada casa', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`

    const applicant = await seedApplicant(db)
    await seedApplication(db, {
      applicantId: applicant.id,
      dealerUserId: dealer.id,
      vehicleMake: 'Honda',
      vehicleModel: 'Civic Busca15',
    })

    const res = mockRes()
    await applicationsHandler(
      mockReq('/api/applications?status=cancelled&q=Civic Busca15', { headers: { cookie } }),
      res,
    )
    const body = res.body as { items: unknown[]; hasMore: boolean }
    // A proposta criada acima fica em draft, não cancelled — a combinação não bate com nada.
    expect(body.items).toEqual([])
    expect(body.hasMore).toBe(false)
  })

  it('ignora silenciosamente um valor de status inválido', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`

    const res = mockRes()
    await applicationsHandler(
      mockReq('/api/applications?status=nao-existe', { headers: { cookie } }),
      res,
    )
    expect(res.statusCode).toBe(200)
  })
})
