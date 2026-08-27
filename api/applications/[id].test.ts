import applicationDetailHandler from './[id]'
import submitHandler from '../client/[token]/submit'
import { getDb } from '../_lib/db'
import { seedApplicant, seedApplication, seedDealerUser } from '../_lib/testFixtures'
import { transition } from '../_lib/stateMachine'
import { createSessionToken, SESSION_COOKIE_NAME } from '../_lib/auth'
import { mockReq, mockRes } from '../_lib/testHttp'

describe('GET /api/applications/[id] — visibilidade de consentimento (Fase 12)', () => {
  it('lista só os tipos de consentimento que o cliente de fato marcou', async () => {
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

    await submitHandler(
      mockReq(`/api/client/${application.clientPortalToken}/submit`, {
        method: 'POST',
        body: {
          birthDate: '1990-01-01',
          address: { street: 'Rua X', number: '1', city: 'SP', state: 'SP', zip: '01000-000' },
          monthlyIncomeDeclared: 5000,
          consent: true,
          consentBureauCheck: true,
          consentAiNarrativeShare: false,
        },
      }),
      mockRes(),
    )

    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`
    const res = mockRes()
    await applicationDetailHandler(
      mockReq(`/api/applications/${application.id}`, { headers: { cookie } }),
      res,
    )

    const body = res.body as { consents: { consentType: string; revokedAt: string | null }[] }
    const grantedTypes = body.consents.map((c) => c.consentType).sort()
    expect(grantedTypes).toEqual(['bureau_check', 'data_processing'])
    expect(body.consents.every((c) => c.revokedAt === null)).toBe(true)
  })

  it('proposta sem nenhum consentimento devolve lista vazia', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const applicant = await seedApplicant(db)
    const application = await seedApplication(db, {
      applicantId: applicant.id,
      dealerUserId: dealer.id,
    })
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`

    const res = mockRes()
    await applicationDetailHandler(
      mockReq(`/api/applications/${application.id}`, { headers: { cookie } }),
      res,
    )

    expect((res.body as { consents: unknown[] }).consents).toEqual([])
  })
})

describe('PATCH /api/applications/[id] — edição de proposta (Fase 14)', () => {
  it('atualiza os campos editáveis, incluindo a placa, enquanto a proposta está em draft', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const applicant = await seedApplicant(db)
    const application = await seedApplication(db, {
      applicantId: applicant.id,
      dealerUserId: dealer.id,
    })
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`

    const res = mockRes()
    await applicationDetailHandler(
      mockReq(`/api/applications/${application.id}`, {
        method: 'PATCH',
        headers: { cookie },
        body: { vehiclePlate: 'XYZ9K88', requestedAmount: 65000 },
      }),
      res,
    )

    expect(res.statusCode).toBe(200)
    const body = res.body as { vehiclePlate: string; requestedAmount: number }
    expect(body.vehiclePlate).toBe('XYZ9K88')
    expect(body.requestedAmount).toBe(65000)
  })

  it('recusa a edição com 409 fora dos status editáveis', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const applicant = await seedApplicant(db)
    const application = await seedApplication(db, {
      applicantId: applicant.id,
      dealerUserId: dealer.id,
    })
    const actor = { actorType: 'dealer_user' as const, actorId: dealer.id }
    await transition(db, application.id, 'link_sent', actor)
    await transition(db, application.id, 'client_submitted', actor)
    await transition(db, application.id, 'processing_documents', actor)

    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`
    const res = mockRes()
    await applicationDetailHandler(
      mockReq(`/api/applications/${application.id}`, {
        method: 'PATCH',
        headers: { cookie },
        body: { requestedAmount: 65000 },
      }),
      res,
    )

    expect(res.statusCode).toBe(409)
    expect((res.body as { error: string }).error).toBe('not_editable')
  })
})
