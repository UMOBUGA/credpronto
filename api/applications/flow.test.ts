import applicationsIndexHandler from './index'
import applicationDetailHandler from './[id]'
import bureauCheckHandler from '../bureau/check'
import decisionHandler from './[id]/decision'
import offerHandler from './[id]/offer'
import clientViewHandler from '../client/[token]'
import clientSubmitHandler from '../client/[token]/submit'
import clientDocumentsHandler from '../client/[token]/documents'
import { getDb } from '../_lib/db'
import { seedDealerUser } from '../_lib/testFixtures'
import { createSessionToken, SESSION_COOKIE_NAME } from '../_lib/auth'
import { mockReq, mockRes } from '../_lib/testHttp'

/**
 * Exercita a esteira inteira da Fase 1 ponta a ponta, chamando os handlers
 * diretamente (sem servidor HTTP real) contra o mesmo PGlite em memória —
 * é o teste que prova o critério de "pronto" da Fase 1: caminho feliz sem
 * nenhuma credencial externa.
 */
describe('esteira — caminho feliz (Fase 1, tudo simulado)', () => {
  const originalScenario = process.env.MOCK_BUREAU_SCENARIO

  beforeAll(() => {
    // Força o bureau mock para "limpo": o teste verifica o fluxo da esteira,
    // não a distribuição aleatória do mock — determinístico de propósito.
    process.env.MOCK_BUREAU_SCENARIO = 'clean'
  })
  afterAll(() => {
    process.env.MOCK_BUREAU_SCENARIO = originalScenario
  })

  it('cria proposta, cliente envia dados e documento, bureau roda, decisão é calculada e a oferta é gerada', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`

    const createRes = mockRes()
    await applicationsIndexHandler(
      mockReq('/api/applications', {
        method: 'POST',
        headers: { cookie },
        body: {
          applicant: {
            fullName: 'Ciclano de Teste',
            cpf: '39053344705',
            phone: '11988887777',
            email: 'ciclano@example.test',
          },
          vehicleMake: 'Fiat',
          vehicleModel: 'Argo',
          vehicleYear: 2022,
          vehiclePrice: 80000,
          downPayment: 10000,
          requestedAmount: 70000,
          requestedTermMonths: 48,
        },
      }),
      createRes,
    )
    expect(createRes.statusCode).toBe(201)
    const created = createRes.body as { id: string; clientPortalToken: string; status: string }
    expect(created.status).toBe('link_sent')
    const { id: applicationId, clientPortalToken: token } = created

    const clientViewRes = mockRes()
    await clientViewHandler(mockReq(`/api/client/${token}`), clientViewRes)
    expect(clientViewRes.statusCode).toBe(200)
    expect((clientViewRes.body as { status: string }).status).toBe('link_sent')

    const submitRes = mockRes()
    await clientSubmitHandler(
      mockReq(`/api/client/${token}/submit`, {
        method: 'POST',
        body: {
          birthDate: '1990-01-01',
          address: {
            street: 'Rua Teste',
            number: '100',
            city: 'São Paulo',
            state: 'SP',
            zip: '01000-000',
          },
          monthlyIncomeDeclared: 10000,
          consent: true,
        },
      }),
      submitRes,
    )
    expect(submitRes.statusCode).toBe(200)

    const documentRes = mockRes()
    await clientDocumentsHandler(
      mockReq(`/api/client/${token}/documents`, {
        method: 'POST',
        body: {
          type: 'comprovante_renda',
          filename: 'comprovante.pdf',
          contentBase64: Buffer.from('conteúdo fake de teste').toString('base64'),
        },
      }),
      documentRes,
    )
    expect(documentRes.statusCode).toBe(201)

    const bureauRes = mockRes()
    await bureauCheckHandler(
      mockReq('/api/bureau/check', {
        method: 'POST',
        headers: { cookie },
        body: { applicationId },
      }),
      bureauRes,
    )
    expect(bureauRes.statusCode).toBe(201)
    expect((bureauRes.body as { hasRestriction: boolean }).hasRestriction).toBe(false)

    const decisionRes = mockRes()
    await decisionHandler(
      mockReq(`/api/applications/${applicationId}/decision`, {
        method: 'POST',
        headers: { cookie },
      }),
      decisionRes,
    )
    expect(decisionRes.statusCode).toBe(201)
    expect((decisionRes.body as { outcome: string }).outcome).toBe('approved')

    const offerRes = mockRes()
    await offerHandler(
      mockReq(`/api/applications/${applicationId}/offer`, {
        method: 'POST',
        headers: { cookie },
        body: {},
      }),
      offerRes,
    )
    expect(offerRes.statusCode).toBe(201)
    expect((offerRes.body as { monthlyPayment: number }).monthlyPayment).toBeGreaterThan(0)

    const detailRes = mockRes()
    await applicationDetailHandler(
      mockReq(`/api/applications/${applicationId}`, { headers: { cookie } }),
      detailRes,
    )
    const detail = detailRes.body as { status: string; applicant: { fullName: string } }
    expect(detail.status).toBe('offer_created')
    expect(detail.applicant.fullName).toBe('Ciclano de Teste')
  })
})
