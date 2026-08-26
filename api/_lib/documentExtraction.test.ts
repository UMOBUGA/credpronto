const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock }
  },
}))

import { eq } from 'drizzle-orm'
import { getDb } from './db'
import { documents, type DocumentType } from './schema'
import { putDocument } from './storage'
import { runExtraction } from './documentExtraction'
import { seedApplicant, seedApplication, seedDealerUser } from './testFixtures'

function mockToolResponse(input: unknown) {
  createMock.mockResolvedValue({
    model: 'claude-opus-5',
    content: [{ type: 'tool_use', id: 't', name: 'extract_document_fields', input }],
  })
}

async function seedDocument(type: DocumentType) {
  const db = await getDb()
  const dealer = await seedDealerUser(db)
  const applicant = await seedApplicant(db)
  const application = await seedApplication(db, {
    applicantId: applicant.id,
    dealerUserId: dealer.id,
  })
  const { storageKey } = await putDocument(Buffer.from('conteúdo fake de teste'), '.jpg')
  const [document] = await db
    .insert(documents)
    .values({
      applicationId: application.id,
      type,
      storageKey,
      mimeType: 'image/jpeg',
      uploadedBy: 'applicant',
      status: 'uploaded',
    })
    .returning()
  return { db, document: document! }
}

describe('runExtraction', () => {
  beforeEach(() => {
    createMock.mockReset()
  })

  it('marca auto_accepted quando a confiança é alta e não há problema', async () => {
    const { db, document } = await seedDocument('comprovante_renda')
    mockToolResponse({
      fields: { nome: 'Fulano', rendaMensalDeclarada: '8000' },
      confidence: 0.9,
      issues: [],
    })

    const result = await runExtraction(db, document.id)

    expect(result).toEqual({ documentStatus: 'extracted', extractionStatus: 'auto_accepted' })
    const [updated] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, document.id))
      .limit(1)
    expect(updated?.status).toBe('extracted')
  })

  it('marca needs_review quando a confiança está abaixo do limiar', async () => {
    const { db, document } = await seedDocument('comprovante_renda')
    mockToolResponse({ fields: {}, confidence: 0.3, issues: ['imagem borrada'] })

    const result = await runExtraction(db, document.id)

    expect(result).toEqual({ documentStatus: 'extracted', extractionStatus: 'needs_review' })
  })

  it('marca needs_review quando o CPF extraído falha no checksum, mesmo com confiança alta', async () => {
    const { db, document } = await seedDocument('rg')
    mockToolResponse({
      fields: { nome: 'Fulano', cpf: '11111111111' },
      confidence: 0.99,
      issues: [],
    })

    const result = await runExtraction(db, document.id)

    expect(result.extractionStatus).toBe('needs_review')
  })

  it('aceita quando o CPF extraído tem checksum válido', async () => {
    const { db, document } = await seedDocument('rg')
    mockToolResponse({
      fields: { nome: 'Fulano', cpf: '390.533.447-05' },
      confidence: 0.95,
      issues: [],
    })

    const result = await runExtraction(db, document.id)

    expect(result.extractionStatus).toBe('auto_accepted')
  })

  it('marca o documento como failed quando a chamada à IA lança', async () => {
    const { db, document } = await seedDocument('comprovante_renda')
    createMock.mockRejectedValue(new Error('fora do ar'))

    const result = await runExtraction(db, document.id)

    expect(result).toEqual({ documentStatus: 'failed', extractionStatus: null })
    const [updated] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, document.id))
      .limit(1)
    expect(updated?.status).toBe('failed')
  })
})
