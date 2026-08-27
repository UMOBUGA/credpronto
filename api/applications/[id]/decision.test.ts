import { eq } from 'drizzle-orm'
import decisionHandler from './decision'
import { getDb } from '../../_lib/db'
import { antifraudChecks, bureauChecks, notificationLog, vehicleChecks } from '../../_lib/schema'
import { seedApplicant, seedApplication, seedDealerUser } from '../../_lib/testFixtures'
import { transition } from '../../_lib/stateMachine'
import { createSessionToken, SESSION_COOKIE_NAME } from '../../_lib/auth'
import { mockReq, mockRes } from '../../_lib/testHttp'

/**
 * `manual_review` não é uma decisão pra avisar o cliente (Fase 16) — só
 * `resolve.ts`, que só produz `approved`/`denied`, dispara notificação nesse
 * caso. Este teste força `manual_review` via um flag grave de antifraude
 * (checado antes de qualquer outro fator em `decide()`) e confirma que
 * `POST /api/applications/[id]/decision` não grava nada em
 * `notification_log`.
 */
describe('POST /api/applications/[id]/decision — manual_review não notifica (Fase 16)', () => {
  it('não dispara notificação quando o motor devolve manual_review', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const applicant = await seedApplicant(db)
    const application = await seedApplication(db, {
      applicantId: applicant.id,
      dealerUserId: dealer.id,
    })
    const actor = { actorType: 'dealer_user' as const, actorId: dealer.id }
    for (const status of [
      'link_sent',
      'client_submitted',
      'processing_documents',
      'documents_verified',
      'awaiting_openfinance_consent',
      'openfinance_authorized',
      'running_checks',
    ] as const) {
      await transition(db, application.id, status, actor)
    }

    await db
      .insert(bureauChecks)
      .values({ applicationId: application.id, score: 750, hasRestriction: false })
    await db.insert(vehicleChecks).values({
      applicationId: application.id,
      restrictionFound: false,
      source: 'test-fixture',
    })
    await db.insert(antifraudChecks).values({
      applicationId: application.id,
      riskScore: 30,
      flagsJson: ['known_fraud_list'],
      provider: 'test-fixture',
    })

    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`
    const res = mockRes()
    await decisionHandler(
      mockReq(`/api/applications/${application.id}/decision`, {
        method: 'POST',
        headers: { cookie },
      }),
      res,
    )

    expect(res.statusCode).toBe(201)
    expect((res.body as { outcome: string }).outcome).toBe('manual_review')

    const notifications = await db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.applicationId, application.id))
    expect(notifications).toEqual([])
  })
})
