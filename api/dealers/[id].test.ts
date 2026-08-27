import { eq } from 'drizzle-orm'
import dealerDetailHandler from './[id]'
import { getDb } from '../_lib/db'
import { dealerUsers } from '../_lib/schema'
import { seedDealerUser } from '../_lib/testFixtures'
import { createSessionToken, SESSION_COOKIE_NAME } from '../_lib/auth'
import { mockReq, mockRes } from '../_lib/testHttp'

describe('PATCH /api/dealers/[id] — restrito a admin (Fase 17)', () => {
  it('manager recebe 403', async () => {
    const db = await getDb()
    const manager = await seedDealerUser(db, 'manager')
    const target = await seedDealerUser(db, 'analyst')
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(manager.id)}`

    const res = mockRes()
    await dealerDetailHandler(
      mockReq(`/api/dealers/${target.id}`, {
        method: 'PATCH',
        headers: { cookie },
        body: { role: 'manager' },
      }),
      res,
    )

    expect(res.statusCode).toBe(403)
  })

  it('admin troca o papel de outro usuário', async () => {
    const db = await getDb()
    const admin = await seedDealerUser(db, 'admin')
    const target = await seedDealerUser(db, 'analyst')
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(admin.id)}`

    const res = mockRes()
    await dealerDetailHandler(
      mockReq(`/api/dealers/${target.id}`, {
        method: 'PATCH',
        headers: { cookie },
        body: { role: 'manager' },
      }),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect((res.body as { role: string }).role).toBe('manager')

    const [row] = await db.select().from(dealerUsers).where(eq(dealerUsers.id, target.id)).limit(1)
    expect(row?.role).toBe('manager')
  })

  it('admin desativa e reativa outro usuário', async () => {
    const db = await getDb()
    const admin = await seedDealerUser(db, 'admin')
    const target = await seedDealerUser(db, 'analyst')
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(admin.id)}`

    const disableRes = mockRes()
    await dealerDetailHandler(
      mockReq(`/api/dealers/${target.id}`, {
        method: 'PATCH',
        headers: { cookie },
        body: { disabled: true },
      }),
      disableRes,
    )
    expect(disableRes.statusCode).toBe(200)
    expect((disableRes.body as { disabledAt: string | null }).disabledAt).not.toBeNull()

    const enableRes = mockRes()
    await dealerDetailHandler(
      mockReq(`/api/dealers/${target.id}`, {
        method: 'PATCH',
        headers: { cookie },
        body: { disabled: false },
      }),
      enableRes,
    )
    expect(enableRes.statusCode).toBe(200)
    expect((enableRes.body as { disabledAt: string | null }).disabledAt).toBeNull()
  })

  it('admin não consegue desativar a própria conta', async () => {
    const db = await getDb()
    const admin = await seedDealerUser(db, 'admin')
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(admin.id)}`

    const res = mockRes()
    await dealerDetailHandler(
      mockReq(`/api/dealers/${admin.id}`, {
        method: 'PATCH',
        headers: { cookie },
        body: { disabled: true },
      }),
      res,
    )

    expect(res.statusCode).toBe(409)
    const [row] = await db.select().from(dealerUsers).where(eq(dealerUsers.id, admin.id)).limit(1)
    expect(row?.disabledAt).toBeNull()
  })

  it('devolve 404 pra usuário inexistente', async () => {
    const db = await getDb()
    const admin = await seedDealerUser(db, 'admin')
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(admin.id)}`

    const res = mockRes()
    await dealerDetailHandler(
      mockReq('/api/dealers/00000000-0000-0000-0000-000000000000', {
        method: 'PATCH',
        headers: { cookie },
        body: { role: 'manager' },
      }),
      res,
    )

    expect(res.statusCode).toBe(404)
  })

  it('devolve 400 quando o corpo não muda nada', async () => {
    const db = await getDb()
    const admin = await seedDealerUser(db, 'admin')
    const target = await seedDealerUser(db, 'analyst')
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(admin.id)}`

    const res = mockRes()
    await dealerDetailHandler(
      mockReq(`/api/dealers/${target.id}`, {
        method: 'PATCH',
        headers: { cookie },
        body: {},
      }),
      res,
    )

    expect(res.statusCode).toBe(400)
  })
})
