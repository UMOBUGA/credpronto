import { eq } from 'drizzle-orm'
import openfinanceHandler from './openfinance'
import { getDb } from '../../_lib/db'
import { applications, openfinanceConsents, openfinanceData } from '../../_lib/schema'
import { seedApplicant, seedApplication, seedDealerUser } from '../../_lib/testFixtures'
import { transition } from '../../_lib/stateMachine'
import { mockReq, mockRes } from '../../_lib/testHttp'

async function seedApplicationAwaitingConsent() {
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
  ] as const) {
    await transition(db, application.id, status, actor)
  }
  return { db, application }
}

describe('POST /api/client/[token]/openfinance', () => {
  const originalScenario = process.env.MOCK_OPENFINANCE_SCENARIO

  beforeEach(() => {
    process.env.MOCK_OPENFINANCE_SCENARIO = 'clean'
  })
  afterAll(() => {
    process.env.MOCK_OPENFINANCE_SCENARIO = originalScenario
  })

  it('autoriza e salva consentimento + os três tipos de dado', async () => {
    const { db, application } = await seedApplicationAwaitingConsent()

    const res = mockRes()
    await openfinanceHandler(
      mockReq(`/api/client/${application.clientPortalToken}/openfinance`, {
        method: 'POST',
        body: { decision: 'authorize' },
      }),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect((res.body as { status: string }).status).toBe('openfinance_authorized')

    const [updated] = await db
      .select()
      .from(applications)
      .where(eq(applications.id, application.id))
      .limit(1)
    expect(updated?.status).toBe('openfinance_authorized')

    const [consent] = await db
      .select()
      .from(openfinanceConsents)
      .where(eq(openfinanceConsents.applicationId, application.id))
      .limit(1)
    expect(consent?.status).toBe('authorized')
    expect(consent?.accessTokenEncrypted).not.toBeNull()

    const dataRows = await db
      .select()
      .from(openfinanceData)
      .where(eq(openfinanceData.consentId, consent!.id))
    expect(dataRows).toHaveLength(3)
    expect(dataRows.map((row) => row.dataType).sort()).toEqual([
      'accounts',
      'income',
      'transactions',
    ])
  })

  it('nega e marca openfinance_failed sem criar dado financeiro', async () => {
    const { db, application } = await seedApplicationAwaitingConsent()

    const res = mockRes()
    await openfinanceHandler(
      mockReq(`/api/client/${application.clientPortalToken}/openfinance`, {
        method: 'POST',
        body: { decision: 'deny' },
      }),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect((res.body as { status: string }).status).toBe('openfinance_failed')

    const [updated] = await db
      .select()
      .from(applications)
      .where(eq(applications.id, application.id))
      .limit(1)
    expect(updated?.status).toBe('openfinance_failed')

    const [consent] = await db
      .select()
      .from(openfinanceConsents)
      .where(eq(openfinanceConsents.applicationId, application.id))
      .limit(1)
    expect(consent?.status).toBe('rejected')

    const dataRows = await db
      .select()
      .from(openfinanceData)
      .where(eq(openfinanceData.consentId, consent!.id))
    expect(dataRows).toHaveLength(0)
  })

  it('rejeita quando a proposta ainda não chegou em awaiting_openfinance_consent', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const applicant = await seedApplicant(db)
    const application = await seedApplication(db, {
      applicantId: applicant.id,
      dealerUserId: dealer.id,
    })

    const res = mockRes()
    await openfinanceHandler(
      mockReq(`/api/client/${application.clientPortalToken}/openfinance`, {
        method: 'POST',
        body: { decision: 'authorize' },
      }),
      res,
    )

    expect(res.statusCode).toBe(409)
  })
})
