import { z } from 'zod'
import { getDb } from '../../_lib/db'
import { documents } from '../../_lib/schema'
import { putDocument } from '../../_lib/storage'
import { encryptField } from '../../_lib/crypto'
import { requireApplicationByToken } from '../../_lib/auth'
import { logAction } from '../../_lib/audit'
import { runExtraction } from '../../_lib/documentExtraction'
import { enforceRateLimit } from '../../_lib/rateLimit'
import { pathSegment, readJsonBody, sendJson, type Handler } from '../../_lib/http'

const ALLOWED_STATUSES = new Set([
  'client_submitted',
  'processing_documents',
  'documents_review_required',
])
const MAX_BYTES = 10 * 1024 * 1024
const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
])

const bodySchema = z.object({
  type: z.enum(['rg', 'cpf', 'cnh', 'passaporte', 'comprovante_renda', 'comprovante_residencia']),
  filename: z.string().min(1),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']),
  contentBase64: z.string().min(1),
  // Digitado pelo cliente junto com a foto (Fase 8) — ver `src/shared/documentTypes.ts`
  // pra saber quais campos cada tipo de documento pede. Independente da
  // extração por IA: redundância deliberada pro dealer comparar.
  manualFields: z.record(z.string(), z.string()).optional(),
})

/**
 * A extração roda de forma SÍNCRONA aqui, antes de responder — desvio
 * deliberado do plano original ("assíncrono, não bloqueia o upload"). Uma
 * função Vercel Node comum não tem um jeito confiável de continuar
 * trabalhando depois de `res.end()` sem acoplar o código a uma API
 * específica do Vercel (`waitUntil`), o que contradiz a convenção do projeto
 * de handlers portáveis entre dev e produção. A troca é aceitável: a
 * resposta demora alguns segundos a mais, mas o cliente já recebe o status
 * final da extração na mesma requisição, sem precisar de polling.
 */
const handler: Handler = async (req, res) => {
  if (!enforceRateLimit(req, res, 'client.documents', 20, 60 * 1000)) return

  const db = await getDb()
  const token = pathSegment(req, 1)
  const application = await requireApplicationByToken(res, db, token)
  if (!application) return

  if (!ALLOWED_STATUSES.has(application.status)) {
    sendJson(res, 409, { error: 'not_ready', status: application.status })
    return
  }

  const parsed = bodySchema.safeParse(await readJsonBody(req))
  if (!parsed.success) {
    sendJson(res, 400, { error: 'invalid_body' })
    return
  }

  const buffer = Buffer.from(parsed.data.contentBase64, 'base64')
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) {
    sendJson(res, 400, { error: 'invalid_file_size' })
    return
  }
  if (!SUPPORTED_MIME_TYPES.has(parsed.data.mimeType)) {
    sendJson(res, 400, { error: 'unsupported_mime_type' })
    return
  }

  const extension = parsed.data.filename.includes('.')
    ? `.${parsed.data.filename.split('.').pop()}`
    : ''
  const { storageKey } = await putDocument(buffer, extension)

  const [document] = await db
    .insert(documents)
    .values({
      applicationId: application.id,
      type: parsed.data.type,
      storageKey,
      mimeType: parsed.data.mimeType,
      uploadedBy: 'applicant',
      status: 'uploaded',
      manualFieldsEncrypted: parsed.data.manualFields
        ? encryptField(JSON.stringify(parsed.data.manualFields))
        : null,
    })
    .returning()

  await logAction(
    db,
    { actorType: 'applicant', actorId: application.applicantId },
    {
      action: 'document.uploaded',
      entityType: 'document',
      entityId: document!.id,
      applicationId: application.id,
      metadata: { type: parsed.data.type },
    },
  )

  const extraction = await runExtraction(db, document!.id)

  sendJson(res, 201, { ...document, status: extraction.documentStatus })
}

export default handler
