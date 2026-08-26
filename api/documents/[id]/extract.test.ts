const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock }
  },
}))

import { eq } from 'drizzle-orm'
import extractHandler from './extract'
import { getDb } from '../../_lib/db'
import { documentExtractions, documents } from '../../_lib/schema'
import { encryptField } from '../../_lib/crypto'
import { putDocument } from '../../_lib/storage'
import { seedApplicant, seedApplication, seedDealerUser } from '../../_lib/testFixtures'
import { createSessionToken, SESSION_COOKIE_NAME } from '../../_lib/auth'
import { mockReq, mockRes } from '../../_lib/testHttp'

async function seedNeedsReviewDocument() {
  const db = await getDb()
  const dealer = await seedDealerUser(db)
  const applicant = await seedApplicant(db)
  const application = await seedApplication(db, {
    applicantId: applicant.id,
    dealerUserId: dealer.id,
  })
  const { storageKey } = await putDocument(Buffer.from('conteúdo fake'), '.jpg')
  const [document] = await db
    .insert(documents)
    .values({
      applicationId: application.id,
      type: 'rg',
      storageKey,
      mimeType: 'image/jpeg',
      uploadedBy: 'applicant',
      status: 'extracted',
    })
    .returning()
  await db.insert(documentExtractions).values({
    documentId: document!.id,
    extractedFieldsEncrypted: encryptField(JSON.stringify({ nome: 'Fulano', cpf: '11111111111' })),
    confidenceScore: 0.5,
    modelUsed: 'claude-opus-5',
    status: 'needs_review',
  })
  const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`
  return { db, document: document!, dealer, cookie }
}

describe('api/documents/[id]/extract', () => {
  beforeEach(() => {
    createMock.mockReset()
  })

  it('PATCH approve marca a extração como reviewed', async () => {
    const { document, cookie } = await seedNeedsReviewDocument()
    const res = mockRes()

    await extractHandler(
      mockReq(`/api/documents/${document.id}/extract`, {
        method: 'PATCH',
        headers: { cookie },
        body: { action: 'approve' },
      }),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect((res.body as { status: string }).status).toBe('reviewed')
  })

  it('PATCH correct sobrescreve os campos e marca reviewed', async () => {
    const { db, document, cookie } = await seedNeedsReviewDocument()
    const res = mockRes()

    await extractHandler(
      mockReq(`/api/documents/${document.id}/extract`, {
        method: 'PATCH',
        headers: { cookie },
        body: { action: 'correct', fields: { nome: 'Fulano Corrigido', cpf: '39053344705' } },
      }),
      res,
    )

    expect(res.statusCode).toBe(200)
    const [extraction] = await db
      .select()
      .from(documentExtractions)
      .where(eq(documentExtractions.documentId, document.id))
      .limit(1)
    expect(extraction?.status).toBe('reviewed')
  })

  it('PATCH reject marca a extração como rejected', async () => {
    const { document, cookie } = await seedNeedsReviewDocument()
    const res = mockRes()

    await extractHandler(
      mockReq(`/api/documents/${document.id}/extract`, {
        method: 'PATCH',
        headers: { cookie },
        body: { action: 'reject' },
      }),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect((res.body as { status: string }).status).toBe('rejected')
  })

  it('PATCH rejeita quando a extração já não está mais needs_review', async () => {
    const { document, cookie } = await seedNeedsReviewDocument()

    const first = mockRes()
    await extractHandler(
      mockReq(`/api/documents/${document.id}/extract`, {
        method: 'PATCH',
        headers: { cookie },
        body: { action: 'approve' },
      }),
      first,
    )

    const second = mockRes()
    await extractHandler(
      mockReq(`/api/documents/${document.id}/extract`, {
        method: 'PATCH',
        headers: { cookie },
        body: { action: 'approve' },
      }),
      second,
    )

    expect(second.statusCode).toBe(409)
  })

  it('POST reprocessa um documento que falhou', async () => {
    const db = await getDb()
    const dealer = await seedDealerUser(db)
    const applicant = await seedApplicant(db)
    const application = await seedApplication(db, {
      applicantId: applicant.id,
      dealerUserId: dealer.id,
    })
    const { storageKey } = await putDocument(Buffer.from('conteúdo fake'), '.jpg')
    const [document] = await db
      .insert(documents)
      .values({
        applicationId: application.id,
        type: 'comprovante_renda',
        storageKey,
        mimeType: 'image/jpeg',
        uploadedBy: 'applicant',
        status: 'failed',
      })
      .returning()
    const cookie = `${SESSION_COOKIE_NAME}=${createSessionToken(dealer.id)}`

    createMock.mockResolvedValue({
      model: 'claude-opus-5',
      content: [
        {
          type: 'tool_use',
          id: 't',
          name: 'extract_document_fields',
          input: { fields: { nome: 'Fulano' }, confidence: 0.9, issues: [] },
        },
      ],
    })

    const res = mockRes()
    await extractHandler(
      mockReq(`/api/documents/${document!.id}/extract`, { method: 'POST', headers: { cookie } }),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect((res.body as { documentStatus: string }).documentStatus).toBe('extracted')
  })
})
