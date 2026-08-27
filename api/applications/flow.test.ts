import { eq } from 'drizzle-orm'

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock }
  },
}))

import applicationsIndexHandler from './index'
import applicationDetailHandler from './[id]'
import bureauCheckHandler from '../bureau/check'
import decisionHandler from './[id]/decision'
import offerHandler from './[id]/offer'
import clientViewHandler from '../client/[token]'
import clientSubmitHandler from '../client/[token]/submit'
import clientDocumentsHandler from '../client/[token]/documents'
import clientOpenfinanceHandler from '../client/[token]/openfinance'
import { getDb } from '../_lib/db'
import { notificationLog } from '../_lib/schema'
import { seedDealerUser } from '../_lib/testFixtures'
import { createSessionToken, SESSION_COOKIE_NAME } from '../_lib/auth'
import { mockReq, mockRes } from '../_lib/testHttp'

/**
 * Exercita a esteira inteira ponta a ponta (Fases 0-5), chamando os
 * handlers diretamente (sem servidor HTTP real) contra o mesmo PGlite em
 * memória. O SDK da Anthropic é mockado — nunca chama a API real em CI —
 * respondendo de forma diferente pra cada ferramenta (extração de
 * documento vs. parecer de risco, já que os dois pontos de integração de
 * IA usam o mesmo client mockado neste teste). `fetch` global também é
 * mockado pra nunca bater na BrasilAPI de verdade — a consulta FIPE
 * degrada pra `null` (caminho real e testado, ver `fipe.test.ts` pra
 * cobertura da cadeia de chamadas em si). Open Finance é sempre simulado
 * (`MockOpenFinanceClient`), nunca precisa de mock adicional.
 */
describe('esteira — caminho feliz (tudo simulado, extração de IA mockada)', () => {
  const originalBureauScenario = process.env.MOCK_BUREAU_SCENARIO
  const originalVehicleScenario = process.env.MOCK_VEHICLE_SCENARIO
  const originalAntifraudScenario = process.env.MOCK_ANTIFRAUD_SCENARIO
  const originalOpenfinanceScenario = process.env.MOCK_OPENFINANCE_SCENARIO

  beforeAll(() => {
    // Determinístico de propósito: o teste verifica o fluxo da esteira, não
    // a distribuição aleatória dos mocks.
    process.env.MOCK_BUREAU_SCENARIO = 'clean'
    process.env.MOCK_VEHICLE_SCENARIO = 'clean'
    process.env.MOCK_ANTIFRAUD_SCENARIO = 'clean'
    process.env.MOCK_OPENFINANCE_SCENARIO = 'clean'
  })
  afterAll(() => {
    process.env.MOCK_BUREAU_SCENARIO = originalBureauScenario
    process.env.MOCK_VEHICLE_SCENARIO = originalVehicleScenario
    process.env.MOCK_ANTIFRAUD_SCENARIO = originalAntifraudScenario
    process.env.MOCK_OPENFINANCE_SCENARIO = originalOpenfinanceScenario
  })
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response))
    createMock.mockReset()
    createMock.mockImplementation((params: { tools?: { name: string }[] }) => {
      const toolName = params.tools?.[0]?.name
      if (toolName === 'extract_document_fields') {
        return Promise.resolve({
          model: 'claude-opus-5',
          content: [
            {
              type: 'tool_use',
              id: 't1',
              name: toolName,
              input: {
                fields: { nome: 'Ciclano de Teste', rendaMensalDeclarada: '10000' },
                confidence: 0.95,
                issues: [],
              },
            },
          ],
        })
      }
      if (toolName === 'write_risk_narrative') {
        return Promise.resolve({
          model: 'claude-opus-5',
          content: [
            {
              type: 'tool_use',
              id: 't2',
              name: toolName,
              input: {
                dealerNarrative:
                  'Score alto, DTI baixo, sem restrições — aprovação dentro da regra.',
                applicantNarrative:
                  'Sua proposta foi aprovada! Em breve enviaremos os próximos passos.',
              },
            },
          ],
        })
      }
      throw new Error(`ferramenta inesperada no mock do Claude: ${String(toolName)}`)
    })
  })

  it('cria proposta, cliente envia dados/documento/consentimento, bureau roda, decisão é calculada e a oferta é gerada', async () => {
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
          vehiclePlate: 'ABC1D23',
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
          mimeType: 'application/pdf',
          contentBase64: Buffer.from('conteúdo fake de teste').toString('base64'),
        },
      }),
      documentRes,
    )
    expect(documentRes.statusCode).toBe(201)
    expect((documentRes.body as { status: string }).status).toBe('extracted')

    // Primeira passagem: fase de documentos, para em awaiting_openfinance_consent.
    const firstCheckRes = mockRes()
    await bureauCheckHandler(
      mockReq('/api/bureau/check', {
        method: 'POST',
        headers: { cookie },
        body: { applicationId },
      }),
      firstCheckRes,
    )
    expect(firstCheckRes.statusCode).toBe(200)
    expect((firstCheckRes.body as { status: string }).status).toBe('awaiting_openfinance_consent')

    // Cliente autoriza o Open Finance (simulado).
    const openfinanceRes = mockRes()
    await clientOpenfinanceHandler(
      mockReq(`/api/client/${token}/openfinance`, {
        method: 'POST',
        body: { decision: 'authorize' },
      }),
      openfinanceRes,
    )
    expect(openfinanceRes.statusCode).toBe(200)
    expect((openfinanceRes.body as { status: string }).status).toBe('openfinance_authorized')

    // Segunda passagem: fase de checagens, roda bureau + veículo + antifraude.
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
    const bureauBody = bureauRes.body as {
      bureauCheck: { hasRestriction: boolean }
      vehicleCheck: { restrictionFound: boolean; fipeValue: number | null }
      antifraudCheck: { riskScore: number; flagsJson: string[] }
    }
    expect(bureauBody.bureauCheck.hasRestriction).toBe(false)
    expect(bureauBody.vehicleCheck.restrictionFound).toBe(false)
    expect(bureauBody.vehicleCheck.fipeValue).toBeNull()
    expect(bureauBody.antifraudCheck.flagsJson).toEqual([])

    const decisionRes = mockRes()
    await decisionHandler(
      mockReq(`/api/applications/${applicationId}/decision`, {
        method: 'POST',
        headers: { cookie },
      }),
      decisionRes,
    )
    expect(decisionRes.statusCode).toBe(201)
    const decisionBody = decisionRes.body as {
      outcome: string
      riskNarrativeDealer: string | null
      riskNarrativeApplicant: string | null
    }
    expect(decisionBody.outcome).toBe('approved')
    expect(decisionBody.riskNarrativeDealer).toContain('Score alto')
    expect(decisionBody.riskNarrativeApplicant).toContain('aprovada')

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
    const detail = detailRes.body as {
      status: string
      applicant: { fullName: string }
      documents: { extraction: { status: string; fields: Record<string, string> } | null }[]
      latestOpenfinanceConsent: { status: string; monthlyIncomeEstimate: number | null } | null
    }
    expect(detail.status).toBe('offer_created')
    expect(detail.applicant.fullName).toBe('Ciclano de Teste')
    expect(detail.documents[0]?.extraction?.status).toBe('auto_accepted')
    expect(detail.documents[0]?.extraction?.fields.nome).toBe('Ciclano de Teste')
    expect(detail.latestOpenfinanceConsent?.status).toBe('authorized')
    expect(detail.latestOpenfinanceConsent?.monthlyIncomeEstimate).toBe(20000)

    const clientViewAfterRes = mockRes()
    await clientViewHandler(mockReq(`/api/client/${token}`), clientViewAfterRes)
    const clientViewAfter = clientViewAfterRes.body as {
      decision: { outcome: string; riskNarrativeApplicant: string | null } | null
    }
    expect(clientViewAfter.decision?.outcome).toBe('approved')
    expect(clientViewAfter.decision?.riskNarrativeApplicant).toContain('aprovada')

    // Fase 16: os três gatilhos do caminho feliz disparam notificação —
    // criação do link, decisão pronta (outcome != manual_review) e oferta.
    const notifications = await db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.applicationId, applicationId))
    expect(notifications.map((n) => n.template).sort()).toEqual(
      ['decision_ready', 'link_sent', 'offer_created'].sort(),
    )
    expect(notifications.every((n) => n.status === 'sent')).toBe(true)
  })

  it('quando o cliente nega o Open Finance, a esteira segue sem penalizar a decisão', async () => {
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
            fullName: 'Denise de Teste',
            cpf: '11144477735',
            phone: '11966665555',
            email: 'denise@example.test',
          },
          vehicleMake: 'Fiat',
          vehicleModel: 'Argo',
          vehicleYear: 2022,
          vehiclePrice: 80000,
          vehiclePlate: 'DEN1Y99',
          downPayment: 10000,
          requestedAmount: 70000,
          requestedTermMonths: 48,
        },
      }),
      createRes,
    )
    const { id: applicationId, clientPortalToken: token } = createRes.body as {
      id: string
      clientPortalToken: string
    }

    await clientSubmitHandler(
      mockReq(`/api/client/${token}/submit`, {
        method: 'POST',
        body: {
          birthDate: '1990-01-01',
          address: { street: 'Rua C', number: '1', city: 'SP', state: 'SP', zip: '03000-000' },
          monthlyIncomeDeclared: 10000,
          consent: true,
        },
      }),
      mockRes(),
    )
    await clientDocumentsHandler(
      mockReq(`/api/client/${token}/documents`, {
        method: 'POST',
        body: {
          type: 'comprovante_renda',
          filename: 'comprovante.pdf',
          mimeType: 'application/pdf',
          contentBase64: Buffer.from('conteúdo fake').toString('base64'),
        },
      }),
      mockRes(),
    )
    await bureauCheckHandler(
      mockReq('/api/bureau/check', {
        method: 'POST',
        headers: { cookie },
        body: { applicationId },
      }),
      mockRes(),
    )

    const denyRes = mockRes()
    await clientOpenfinanceHandler(
      mockReq(`/api/client/${token}/openfinance`, { method: 'POST', body: { decision: 'deny' } }),
      denyRes,
    )
    expect((denyRes.body as { status: string }).status).toBe('openfinance_failed')

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
  })

  it('quando a extração precisa de revisão, a esteira para em documents_review_required até o dealer resolver', async () => {
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
            fullName: 'Beltrano de Teste',
            cpf: '15350946056',
            phone: '11977776666',
            email: 'beltrano@example.test',
          },
          vehicleMake: 'VW',
          vehicleModel: 'Polo',
          vehicleYear: 2023,
          vehiclePrice: 90000,
          vehiclePlate: 'XYZ9K87',
          downPayment: 15000,
          requestedAmount: 75000,
          requestedTermMonths: 36,
        },
      }),
      createRes,
    )
    const { id: applicationId, clientPortalToken: token } = createRes.body as {
      id: string
      clientPortalToken: string
    }

    await clientSubmitHandler(
      mockReq(`/api/client/${token}/submit`, {
        method: 'POST',
        body: {
          birthDate: '1985-05-05',
          address: { street: 'Rua B', number: '1', city: 'SP', state: 'SP', zip: '02000-000' },
          monthlyIncomeDeclared: 12000,
          consent: true,
        },
      }),
      mockRes(),
    )

    // Baixa confiança força needs_review mesmo sem erro de API.
    createMock.mockResolvedValue({
      model: 'claude-opus-5',
      content: [
        {
          type: 'tool_use',
          id: 't2',
          name: 'extract_document_fields',
          input: { fields: {}, confidence: 0.1, issues: ['imagem ilegível'] },
        },
      ],
    })

    await clientDocumentsHandler(
      mockReq(`/api/client/${token}/documents`, {
        method: 'POST',
        body: {
          type: 'rg',
          filename: 'rg.jpg',
          mimeType: 'image/jpeg',
          contentBase64: Buffer.from('conteúdo fake ilegível').toString('base64'),
        },
      }),
      mockRes(),
    )

    const bureauRes = mockRes()
    await bureauCheckHandler(
      mockReq('/api/bureau/check', {
        method: 'POST',
        headers: { cookie },
        body: { applicationId },
      }),
      bureauRes,
    )
    expect(bureauRes.statusCode).toBe(200)
    expect((bureauRes.body as { status: string }).status).toBe('documents_review_required')

    const detailRes = mockRes()
    await applicationDetailHandler(
      mockReq(`/api/applications/${applicationId}`, { headers: { cookie } }),
      detailRes,
    )
    expect((detailRes.body as { status: string }).status).toBe('documents_review_required')
  })
})
