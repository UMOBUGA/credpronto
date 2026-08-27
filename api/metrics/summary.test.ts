import summaryHandler from './summary'
import { getDb } from '../_lib/db'
import { creditDecisions } from '../_lib/schema'
import { seedApplicant, seedApplication, seedDealerUser } from '../_lib/testFixtures'
import { transition } from '../_lib/stateMachine'
import { createSessionToken, SESSION_COOKIE_NAME } from '../_lib/auth'
import { mockReq, mockRes } from '../_lib/testHttp'

interface SummaryBody {
  statusCounts: { total: number; reviewing: number; approved: number; closed: number }
  totalDecisions: number
  approvalRate: number | null
  outcomeBreakdown: { approved: number; denied: number; manual_review: number }
  averageDecisionHours: number | null
  scoreDistribution: { label: string; count: number }[]
}

/**
 * As `it()` deste arquivo compartilham um único PGlite em memória (mesmo
 * worker) — por isso a ordem importa: o caso "sem decisão nenhuma" roda
 * primeiro, antes de qualquer outro teste inserir dado. O caso completo,
 * depois, pode afirmar números absolutos porque sabe exatamente o que já
 * existe (só o que ele mesmo semeou).
 */
describe('GET /api/metrics/summary (Fase 18)', () => {
  it('sem sessão recebe 401', async () => {
    const res = mockRes()
    await summaryHandler(mockReq('/api/metrics/summary'), res)
    expect(res.statusCode).toBe(401)
  })

  it('devolve approvalRate e averageDecisionHours nulos sem nenhuma decisão', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`

    const res = mockRes()
    await summaryHandler(mockReq('/api/metrics/summary', { headers: { cookie } }), res)

    expect(res.statusCode).toBe(200)
    const body = res.body as SummaryBody
    expect(body.totalDecisions).toBe(0)
    expect(body.approvalRate).toBeNull()
    expect(body.averageDecisionHours).toBeNull()
    expect(body.scoreDistribution.every((bucket) => bucket.count === 0)).toBe(true)
  })

  it('calcula taxa de aprovação, distribuição de score e tempo médio de decisão', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`
    const actor = { actorType: 'dealer_user' as const, actorId: dealer.id }

    async function seedDecidedApplication(
      outcome: 'approved' | 'denied' | 'manual_review',
      score: number,
    ) {
      const applicant = await seedApplicant(db)
      const application = await seedApplication(db, {
        applicantId: applicant.id,
        dealerUserId: dealer.id,
      })
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
      await transition(db, application.id, outcome, actor)
      await db.insert(creditDecisions).values({
        applicationId: application.id,
        outcome,
        scoreUsed: score,
        factorsJson: { note: 'fixture' },
      })
    }

    await seedDecidedApplication('approved', 800)
    await seedDecidedApplication('approved', 780)
    await seedDecidedApplication('denied', 400)
    await seedDecidedApplication('manual_review', 550)

    const res = mockRes()
    await summaryHandler(mockReq('/api/metrics/summary', { headers: { cookie } }), res)

    expect(res.statusCode).toBe(200)
    const body = res.body as SummaryBody
    expect(body.totalDecisions).toBe(4)
    expect(body.approvalRate).toBeCloseTo(0.5)
    expect(body.outcomeBreakdown).toEqual({ approved: 2, denied: 1, manual_review: 1 })
    // Decidido quase instantaneamente dentro do teste — bem menos de 1h.
    expect(body.averageDecisionHours).not.toBeNull()
    expect(body.averageDecisionHours!).toBeLessThan(1)
    expect(body.statusCounts.total).toBe(4)

    const bucketCount = (label: string) =>
      body.scoreDistribution.find((bucket) => bucket.label === label)?.count
    expect(bucketCount('750–900')).toBe(2)
    expect(bucketCount('450–599')).toBe(1)
    expect(bucketCount('300–449')).toBe(1)
    expect(bucketCount('600–749')).toBe(0)
  })
})
