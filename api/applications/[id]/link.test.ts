import { eq } from 'drizzle-orm'
import linkHandler from './link'
import { getDb } from '../../_lib/db'
import { applications, auditLog } from '../../_lib/schema'
import { seedApplicant, seedApplication, seedDealerUser } from '../../_lib/testFixtures'
import { transition } from '../../_lib/stateMachine'
import { createSessionToken, SESSION_COOKIE_NAME } from '../../_lib/auth'
import { mockReq, mockRes } from '../../_lib/testHttp'

describe('POST /api/applications/[id]/link — reenvio (Fase 12)', () => {
  it('gera um token novo e estende a validade, mantendo o status quando já passou de draft', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const applicant = await seedApplicant(db)
    const application = await seedApplication(db, {
      applicantId: applicant.id,
      dealerUserId: dealer.id,
    })
    await transition(db, application.id, 'link_sent', {
      actorType: 'dealer_user',
      actorId: dealer.id,
    })
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`

    const res = mockRes()
    await linkHandler(
      mockReq(`/api/applications/${application.id}/link`, { method: 'POST', headers: { cookie } }),
      res,
    )

    expect(res.statusCode).toBe(200)
    const body = res.body as { portalPath: string }
    const newToken = body.portalPath.split('/portal/')[1]
    expect(newToken).not.toBe(application.clientPortalToken)

    const [updated] = await db
      .select()
      .from(applications)
      .where(eq(applications.id, application.id))
      .limit(1)
    expect(updated?.clientPortalToken).toBe(newToken)
    expect(updated?.status).toBe('link_sent')
    expect(updated!.clientPortalTokenExpiresAt.getTime()).toBeGreaterThan(
      application.clientPortalTokenExpiresAt.getTime(),
    )

    const audited = await db.select().from(auditLog).where(eq(auditLog.entityId, application.id))
    expect(audited.some((row) => row.action === 'application.link_regenerated')).toBe(true)
  })

  it('sem sessão recebe 401', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const applicant = await seedApplicant(db)
    const application = await seedApplication(db, {
      applicantId: applicant.id,
      dealerUserId: dealer.id,
    })

    const res = mockRes()
    await linkHandler(mockReq(`/api/applications/${application.id}/link`, { method: 'POST' }), res)
    expect(res.statusCode).toBe(401)
  })
})
