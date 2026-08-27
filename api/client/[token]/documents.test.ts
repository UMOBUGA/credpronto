const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock }
  },
}))

import documentsHandler from './documents'
import applicationDetailHandler from '../../applications/[id]'
import { getDb } from '../../_lib/db'
import { seedApplicant, seedApplication, seedDealerUser } from '../../_lib/testFixtures'
import { transition } from '../../_lib/stateMachine'
import { createSessionToken, SESSION_COOKIE_NAME } from '../../_lib/auth'
import { mockReq, mockRes } from '../../_lib/testHttp'

async function seedApplicationReadyForDocuments() {
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
  const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`
  return { db, application, dealer, cookie }
}

describe('POST /api/client/[token]/documents — dados manuais + passaporte (Fase 8)', () => {
  beforeEach(() => {
    createMock.mockReset()
    createMock.mockResolvedValue({
      model: 'claude-opus-5',
      content: [
        {
          type: 'tool_use',
          id: 't1',
          name: 'extract_document_fields',
          input: { fields: { nome: 'Teste' }, confidence: 0.95, issues: [] },
        },
      ],
    })
  })

  it('aceita passaporte com dados manuais e devolve o campo decriptado no detalhe da proposta', async () => {
    const { application, cookie } = await seedApplicationReadyForDocuments()

    const uploadRes = mockRes()
    await documentsHandler(
      mockReq(`/api/client/${application.clientPortalToken}/documents`, {
        method: 'POST',
        body: {
          type: 'passaporte',
          filename: 'passaporte.jpg',
          mimeType: 'image/jpeg',
          contentBase64: Buffer.from('conteúdo fake de passaporte').toString('base64'),
          manualFields: { numeroPassaporte: 'X1234567', paisEmissor: 'Portugal' },
        },
      }),
      uploadRes,
    )
    expect(uploadRes.statusCode).toBe(201)
    expect((uploadRes.body as { type: string }).type).toBe('passaporte')

    const detailRes = mockRes()
    await applicationDetailHandler(
      mockReq(`/api/applications/${application.id}`, { headers: { cookie } }),
      detailRes,
    )
    const detail = detailRes.body as {
      documents: { type: string; manualFields: Record<string, string> | null }[]
    }
    expect(detail.documents).toHaveLength(1)
    expect(detail.documents[0]?.type).toBe('passaporte')
    expect(detail.documents[0]?.manualFields).toEqual({
      numeroPassaporte: 'X1234567',
      paisEmissor: 'Portugal',
    })
  })

  it('continua funcionando sem manualFields — compatibilidade com tipos que não pedem campo extra', async () => {
    const { application, cookie } = await seedApplicationReadyForDocuments()

    const uploadRes = mockRes()
    await documentsHandler(
      mockReq(`/api/client/${application.clientPortalToken}/documents`, {
        method: 'POST',
        body: {
          type: 'rg',
          filename: 'rg.jpg',
          mimeType: 'image/jpeg',
          contentBase64: Buffer.from('conteúdo fake').toString('base64'),
        },
      }),
      uploadRes,
    )
    expect(uploadRes.statusCode).toBe(201)

    const detailRes = mockRes()
    await applicationDetailHandler(
      mockReq(`/api/applications/${application.id}`, { headers: { cookie } }),
      detailRes,
    )
    const detail = detailRes.body as {
      documents: { manualFields: Record<string, string> | null }[]
    }
    expect(detail.documents[0]?.manualFields).toBeNull()
  })
})
