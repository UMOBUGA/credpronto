const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock }
  },
}))

import narrativeHandler from './narrative'
import { getDb } from '../../_lib/db'
import { creditDecisions } from '../../_lib/schema'
import { seedApplicant, seedApplication, seedDealerUser } from '../../_lib/testFixtures'
import { createSessionToken, SESSION_COOKIE_NAME } from '../../_lib/auth'
import { mockReq, mockRes } from '../../_lib/testHttp'

async function seedApplicationWithDecision() {
  const db = await getDb()
  const dealer = await seedDealerUser(db)
  const applicant = await seedApplicant(db)
  const application = await seedApplication(db, {
    applicantId: applicant.id,
    dealerUserId: dealer.id,
  })
  await db.insert(creditDecisions).values({
    applicationId: application.id,
    outcome: 'approved',
    scoreUsed: 800,
    factorsJson: {
      bureauScore: 800,
      hasBureauRestriction: false,
      requestedAmount: 20000,
      monthlyIncomeDeclared: 10000,
      requestedTermMonths: 48,
      vehicleRestrictionFound: false,
      fipeValue: 60000,
      antifraudRiskScore: 0,
      antifraudFlags: [],
      openfinanceVerified: false,
      openfinanceIncomeEstimate: null,
      debtToIncome: 0.05,
      loanToValue: 0.33,
    },
  })
  const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`
  return { db, applicationId: application.id, cookie }
}

describe('POST /api/applications/[id]/narrative', () => {
  beforeEach(() => {
    createMock.mockReset()
  })

  it('gera e salva o parecer quando a chamada é bem-sucedida', async () => {
    const { applicationId, cookie } = await seedApplicationWithDecision()
    createMock.mockResolvedValue({
      model: 'claude-opus-5',
      content: [
        {
          type: 'tool_use',
          id: 'n1',
          name: 'write_risk_narrative',
          input: { dealerNarrative: 'Parecer técnico.', applicantNarrative: 'Parecer simples.' },
        },
      ],
    })

    const res = mockRes()
    await narrativeHandler(
      mockReq(`/api/applications/${applicationId}/narrative`, {
        method: 'POST',
        headers: { cookie },
      }),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect((res.body as { riskNarrativeDealer: string }).riskNarrativeDealer).toBe(
      'Parecer técnico.',
    )
  })

  it('devolve 502 sem quebrar quando a IA falha, e não mexe na decisão', async () => {
    const { applicationId, cookie } = await seedApplicationWithDecision()
    createMock.mockRejectedValue(new Error('fora do ar'))

    const res = mockRes()
    await narrativeHandler(
      mockReq(`/api/applications/${applicationId}/narrative`, {
        method: 'POST',
        headers: { cookie },
      }),
      res,
    )

    expect(res.statusCode).toBe(502)
  })

  it('devolve 404 quando a proposta ainda não tem decisão', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const applicant = await seedApplicant(db)
    const application = await seedApplication(db, {
      applicantId: applicant.id,
      dealerUserId: dealer.id,
    })
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`

    const res = mockRes()
    await narrativeHandler(
      mockReq(`/api/applications/${application.id}/narrative`, {
        method: 'POST',
        headers: { cookie },
      }),
      res,
    )

    expect(res.statusCode).toBe(404)
  })
})
