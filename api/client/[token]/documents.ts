import { z } from 'zod'
import { getDb } from '../../_lib/db'
import { documents } from '../../_lib/schema'
import { putDocument } from '../../_lib/storage'
import { requireApplicationByToken } from '../../_lib/auth'
import { logAction } from '../../_lib/audit'
import { pathSegment, readJsonBody, sendJson, type Handler } from '../../_lib/http'

const ALLOWED_STATUSES = new Set([
  'client_submitted',
  'processing_documents',
  'documents_review_required',
])
const MAX_BYTES = 10 * 1024 * 1024

const bodySchema = z.object({
  type: z.enum(['rg', 'cpf', 'cnh', 'comprovante_renda', 'comprovante_residencia']),
  filename: z.string().min(1),
  contentBase64: z.string().min(1),
})

const handler: Handler = async (req, res) => {
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
      uploadedBy: 'applicant',
      status: 'uploaded',
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

  sendJson(res, 201, document)
}

export default handler
