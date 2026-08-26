import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../../_lib/db'
import { documentExtractions, documents } from '../../_lib/schema'
import { encryptField } from '../../_lib/crypto'
import { requireDealerSession } from '../../_lib/auth'
import { runExtraction } from '../../_lib/documentExtraction'
import { pathSegment, readJsonBody, sendJson, type Handler } from '../../_lib/http'

const RETRYABLE_STATUSES = new Set(['uploaded', 'failed'])

const patchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('correct'), fields: z.record(z.string(), z.string()) }),
  z.object({ action: z.literal('reject') }),
])

/** Retry manual — só faz sentido quando a extração nunca terminou ou falhou. */
async function handlePost(
  res: Parameters<Handler>[1],
  db: Awaited<ReturnType<typeof getDb>>,
  documentId: string,
) {
  const [document] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1)
  if (!document) {
    sendJson(res, 404, { error: 'not_found' })
    return
  }
  if (!RETRYABLE_STATUSES.has(document.status)) {
    sendJson(res, 409, { error: 'not_retryable', status: document.status })
    return
  }

  const result = await runExtraction(db, documentId)
  sendJson(res, 200, result)
}

/** Ação humana sobre uma extração pendente de revisão (`needs_review`). */
async function handlePatch(
  req: Parameters<Handler>[0],
  res: Parameters<Handler>[1],
  db: Awaited<ReturnType<typeof getDb>>,
  documentId: string,
  dealerUserId: string,
) {
  const [extraction] = await db
    .select()
    .from(documentExtractions)
    .where(eq(documentExtractions.documentId, documentId))
    .orderBy(desc(documentExtractions.createdAt))
    .limit(1)
  if (!extraction) {
    sendJson(res, 404, { error: 'no_extraction' })
    return
  }
  if (extraction.status !== 'needs_review') {
    sendJson(res, 409, { error: 'not_reviewable', status: extraction.status })
    return
  }

  const parsed = patchSchema.safeParse(await readJsonBody(req))
  if (!parsed.success) {
    sendJson(res, 400, { error: 'invalid_body' })
    return
  }

  if (parsed.data.action === 'reject') {
    await db
      .update(documentExtractions)
      .set({ status: 'rejected', reviewedBy: dealerUserId, reviewedAt: new Date() })
      .where(eq(documentExtractions.id, extraction.id))
    sendJson(res, 200, { status: 'rejected' })
    return
  }

  const update: {
    status: 'reviewed'
    reviewedBy: string
    reviewedAt: Date
    extractedFieldsEncrypted?: string
  } = {
    status: 'reviewed',
    reviewedBy: dealerUserId,
    reviewedAt: new Date(),
  }
  if (parsed.data.action === 'correct') {
    update.extractedFieldsEncrypted = encryptField(JSON.stringify(parsed.data.fields))
  }

  await db.update(documentExtractions).set(update).where(eq(documentExtractions.id, extraction.id))
  sendJson(res, 200, { status: 'reviewed' })
}

const handler: Handler = async (req, res) => {
  const db = await getDb()
  const user = await requireDealerSession(req, res, db)
  if (!user) return

  const documentId = pathSegment(req, 1)

  if (req.method === 'PATCH') {
    await handlePatch(req, res, db, documentId, user.id)
    return
  }
  await handlePost(res, db, documentId)
}

export default handler
