import { eq } from 'drizzle-orm'
import expireLinksHandler from './expire-links'
import { getDb } from '../_lib/db'
import { applications } from '../_lib/schema'
import { seedApplicant, seedApplication, seedDealerUser } from '../_lib/testFixtures'
import { transition } from '../_lib/stateMachine'
import { mockReq, mockRes } from '../_lib/testHttp'

describe('POST /api/cron/expire-links', () => {
  it('expira propostas em link_sent com token vencido, ignora as demais', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)

    const applicantExpired = await seedApplicant(db)
    const expiredApp = await seedApplication(db, {
      applicantId: applicantExpired.id,
      dealerUserId: dealer.id,
    })
    await transition(db, expiredApp.id, 'link_sent', {
      actorType: 'dealer_user',
      actorId: dealer.id,
    })
    await db
      .update(applications)
      .set({ clientPortalTokenExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(applications.id, expiredApp.id))

    const applicantFresh = await seedApplicant(db)
    const freshApp = await seedApplication(db, {
      applicantId: applicantFresh.id,
      dealerUserId: dealer.id,
    })
    await transition(db, freshApp.id, 'link_sent', { actorType: 'dealer_user', actorId: dealer.id })

    const res = mockRes()
    await expireLinksHandler(mockReq('/api/cron/expire-links'), res)

    expect(res.statusCode).toBe(200)
    const body = res.body as { count: number; expired: string[] }
    expect(body.expired).toContain(expiredApp.id)
    expect(body.expired).not.toContain(freshApp.id)

    const [expiredRow] = await db
      .select({ status: applications.status })
      .from(applications)
      .where(eq(applications.id, expiredApp.id))
      .limit(1)
    expect(expiredRow?.status).toBe('expired')

    const [freshRow] = await db
      .select({ status: applications.status })
      .from(applications)
      .where(eq(applications.id, freshApp.id))
      .limit(1)
    expect(freshRow?.status).toBe('link_sent')
  })

  it('exige CRON_SECRET quando configurado', async () => {
    const original = process.env.CRON_SECRET
    process.env.CRON_SECRET = 'segredo-de-teste'
    try {
      const res = mockRes()
      await expireLinksHandler(mockReq('/api/cron/expire-links'), res)
      expect(res.statusCode).toBe(401)
    } finally {
      process.env.CRON_SECRET = original
    }
  })
})
