import { eq } from 'drizzle-orm'
import dealersHandler from './index'
import { getDb } from '../_lib/db'
import { dealerUsers } from '../_lib/schema'
import { seedDealerUser } from '../_lib/testFixtures'
import { createSessionToken, SESSION_COOKIE_NAME } from '../_lib/auth'
import { mockReq, mockRes } from '../_lib/testHttp'

describe('GET /api/dealers — restrito a admin (Fase 17)', () => {
  it('devolve 403 pra manager e analyst', async () => {
    const db = await getDb()
    for (const role of ['manager', 'analyst'] as const) {
      const dealer = await seedDealerUser(db, role)
      const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`
      const res = mockRes()
      await dealersHandler(mockReq('/api/dealers', { headers: { cookie } }), res)
      expect(res.statusCode).toBe(403)
    }
  })

  it('lista os usuários sem passwordHash', async () => {
    const db = await getDb()
    const admin = await seedDealerUser(db, 'admin')
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(admin.id)}`

    const res = mockRes()
    await dealersHandler(mockReq('/api/dealers', { headers: { cookie } }), res)

    expect(res.statusCode).toBe(200)
    const body = res.body as Record<string, unknown>[]
    expect(body.some((u) => u.id === admin.id)).toBe(true)
    expect(body.every((u) => !('passwordHash' in u))).toBe(true)
  })
})

describe('POST /api/dealers — criar usuário (Fase 17)', () => {
  it('cria um usuário novo com a senha hasheada', async () => {
    const db = await getDb()
    const admin = await seedDealerUser(db, 'admin')
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(admin.id)}`

    const res = mockRes()
    await dealersHandler(
      mockReq('/api/dealers', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: 'Nova Analista',
          email: `nova-${Date.now()}@example.test`,
          password: 'senha12345',
          role: 'analyst',
        },
      }),
      res,
    )

    expect(res.statusCode).toBe(201)
    const body = res.body as { id: string; role: string }
    expect(body.role).toBe('analyst')
    expect('passwordHash' in body).toBe(false)

    const [row] = await db.select().from(dealerUsers).where(eq(dealerUsers.id, body.id)).limit(1)
    expect(row?.passwordHash).not.toBe('senha12345')
    expect(row?.passwordHash).toContain(':')
  })

  it('devolve 409 quando o e-mail já está em uso', async () => {
    const db = await getDb()
    const admin = await seedDealerUser(db, 'admin')
    const existing = await seedDealerUser(db, 'analyst')
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(admin.id)}`

    const res = mockRes()
    await dealersHandler(
      mockReq('/api/dealers', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: 'Duplicado',
          email: existing.email,
          password: 'senha12345',
          role: 'analyst',
        },
      }),
      res,
    )

    expect(res.statusCode).toBe(409)
  })

  it('devolve 400 com senha curta demais', async () => {
    const db = await getDb()
    const admin = await seedDealerUser(db, 'admin')
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(admin.id)}`

    const res = mockRes()
    await dealersHandler(
      mockReq('/api/dealers', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: 'Curta',
          email: `curta-${Date.now()}@example.test`,
          password: '123',
          role: 'analyst',
        },
      }),
      res,
    )

    expect(res.statusCode).toBe(400)
  })

  it('manager não consegue criar usuário', async () => {
    const db = await getDb()
    const manager = await seedDealerUser(db, 'manager')
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(manager.id)}`

    const res = mockRes()
    await dealersHandler(
      mockReq('/api/dealers', {
        method: 'POST',
        headers: { cookie },
        body: {
          name: 'Bloqueado',
          email: `bloqueado-${Date.now()}@example.test`,
          password: 'senha12345',
          role: 'analyst',
        },
      }),
      res,
    )

    expect(res.statusCode).toBe(403)
  })
})
