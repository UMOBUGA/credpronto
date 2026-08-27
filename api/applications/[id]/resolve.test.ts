import { eq } from 'drizzle-orm'
import resolveHandler from './resolve'
import { getDb } from '../../_lib/db'
import { creditDecisions, notificationLog } from '../../_lib/schema'
import { seedApplicant, seedApplication, seedDealerUser } from '../../_lib/testFixtures'
import { transition } from '../../_lib/stateMachine'
import { createSessionToken, SESSION_COOKIE_NAME } from '../../_lib/auth'
import { mockReq, mockRes } from '../../_lib/testHttp'

/**
 * `resolve.ts` nunca tinha teste próprio — este arquivo cobre o caminho
 * básico e, junto com isso, a notificação da Fase 16 (`decision_ready`
 * sempre dispara aqui, já que uma resolução manual nunca produz
 * `manual_review` de novo).
 */
describe('POST /api/applications/[id]/resolve', () => {
  it('grava uma nova decisão a partir da revisão manual e notifica o cliente', async () => {
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
      'manual_review',
    ] as const) {
      await transition(db, application.id, status, actor)
    }
    await db.insert(creditDecisions).values({
      applicationId: application.id,
      outcome: 'manual_review',
      scoreUsed: 500,
      factorsJson: { note: 'fixture' },
    })

    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`
    const res = mockRes()
    await resolveHandler(
      mockReq(`/api/applications/${application.id}/resolve`, {
        method: 'POST',
        headers: { cookie },
        body: { outcome: 'approved' },
      }),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect((res.body as { outcome: string }).outcome).toBe('approved')

    const decisions = await db
      .select()
      .from(creditDecisions)
      .where(eq(creditDecisions.applicationId, application.id))
    expect(decisions).toHaveLength(2)

    const notifications = await db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.applicationId, application.id))
    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toMatchObject({ template: 'decision_ready', status: 'sent' })
  })
})
