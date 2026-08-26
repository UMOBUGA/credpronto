const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock }
  },
}))

import { eq } from 'drizzle-orm'
import { getDb } from './db'
import { creditDecisions } from './schema'
import { generateAndSaveNarrative } from './riskNarrative'
import { seedApplicant, seedApplication, seedDealerUser } from './testFixtures'

const SAMPLE_FACTORS = {
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
}

async function seedDecision() {
  const db = await getDb()
  const dealer = await seedDealerUser(db)
  const applicant = await seedApplicant(db)
  const application = await seedApplication(db, {
    applicantId: applicant.id,
    dealerUserId: dealer.id,
  })
  const [decision] = await db
    .insert(creditDecisions)
    .values({
      applicationId: application.id,
      outcome: 'approved',
      scoreUsed: 800,
      factorsJson: SAMPLE_FACTORS,
    })
    .returning()
  return { db, decision: decision! }
}

describe('generateAndSaveNarrative', () => {
  beforeEach(() => {
    createMock.mockReset()
  })

  it('preenche os dois pareceres quando a chamada é bem-sucedida', async () => {
    const { db, decision } = await seedDecision()
    createMock.mockResolvedValue({
      model: 'claude-opus-5',
      content: [
        {
          type: 'tool_use',
          id: 'n1',
          name: 'write_risk_narrative',
          input: {
            dealerNarrative: 'Parecer técnico de teste.',
            applicantNarrative: 'Parecer para o cliente de teste.',
          },
        },
      ],
    })

    const result = await generateAndSaveNarrative(db, decision.id)

    expect(result).toEqual({ generated: true })
    const [updated] = await db
      .select()
      .from(creditDecisions)
      .where(eq(creditDecisions.id, decision.id))
      .limit(1)
    expect(updated?.riskNarrativeDealer).toBe('Parecer técnico de teste.')
    expect(updated?.riskNarrativeApplicant).toBe('Parecer para o cliente de teste.')
  })

  it('mantém os pareceres nulos quando a chamada à IA falha — a decisão continua válida', async () => {
    const { db, decision } = await seedDecision()
    createMock.mockRejectedValue(new Error('fora do ar'))

    const result = await generateAndSaveNarrative(db, decision.id)

    expect(result).toEqual({ generated: false })
    const [updated] = await db
      .select()
      .from(creditDecisions)
      .where(eq(creditDecisions.id, decision.id))
      .limit(1)
    expect(updated?.riskNarrativeDealer).toBeNull()
    expect(updated?.outcome).toBe('approved')
  })

  it('lança quando a decisão não existe', async () => {
    const db = await getDb()
    await expect(
      generateAndSaveNarrative(db, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow()
  })
})
