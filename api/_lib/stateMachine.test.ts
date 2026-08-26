import { eq } from 'drizzle-orm'
import { getDb } from './db'
import { applications } from './schema'
import { seedApplicant, seedApplication, seedDealerUser } from './testFixtures'
import { canTransition, InvalidTransitionError, transition } from './stateMachine'

describe('canTransition', () => {
  it('permite draft -> link_sent', () => {
    expect(canTransition('draft', 'link_sent')).toBe(true)
  })

  it('rejeita um salto que pula a esteira (draft -> approved)', () => {
    expect(canTransition('draft', 'approved')).toBe(false)
  })

  it('trata approved e denied como terminais', () => {
    expect(canTransition('approved', 'denied')).toBe(false)
    expect(canTransition('denied', 'approved')).toBe(false)
  })

  it('permite manual_review -> approved e -> denied', () => {
    expect(canTransition('manual_review', 'approved')).toBe(true)
    expect(canTransition('manual_review', 'denied')).toBe(true)
  })
})

describe('transition', () => {
  it('avança o status e grava uma linha em audit_log', async () => {
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

    const [updated] = await db
      .select()
      .from(applications)
      .where(eq(applications.id, application.id))
      .limit(1)
    expect(updated?.status).toBe('link_sent')
  })

  it('rejeita uma transição inválida', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const applicant = await seedApplicant(db)
    const application = await seedApplication(db, {
      applicantId: applicant.id,
      dealerUserId: dealer.id,
    })

    await expect(
      transition(db, application.id, 'approved', { actorType: 'dealer_user', actorId: dealer.id }),
    ).rejects.toThrow(InvalidTransitionError)
  })

  it('preenche decidedAt/decidedBy ao entrar num status de decisão', async () => {
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
      'openfinance_failed',
      'running_checks',
      'denied',
    ] as const) {
      await transition(db, application.id, status, actor)
    }

    const [updated] = await db
      .select()
      .from(applications)
      .where(eq(applications.id, application.id))
      .limit(1)
    expect(updated?.status).toBe('denied')
    expect(updated?.decidedAt).not.toBeNull()
    expect(updated?.decidedBy).toBe(dealer.id)
  })
})
