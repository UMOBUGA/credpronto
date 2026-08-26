import { eq } from 'drizzle-orm'
import { getDb } from '../../_lib/db'
import { documents } from '../../_lib/schema'
import { getDocument } from '../../_lib/storage'
import { requireDealerSession } from '../../_lib/auth'
import { pathSegment, sendJson, type Handler } from '../../_lib/http'

/**
 * Proxy autenticado do arquivo bruto — a tela de revisão do dealer
 * (Fase 2) precisa exibir a imagem/PDF ao lado dos campos extraídos, e o
 * `storageKey` (URL pública do Blob ou caminho local) nunca deveria vazar
 * direto pro navegador do dealer sem passar pela sessão.
 */
const handler: Handler = async (req, res) => {
  const db = await getDb()
  const user = await requireDealerSession(req, res, db)
  if (!user) return

  const documentId = pathSegment(req, 1)
  const [document] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1)
  if (!document) {
    sendJson(res, 404, { error: 'not_found' })
    return
  }

  const buffer = await getDocument(document.storageKey)
  res.statusCode = 200
  res.setHeader('Content-Type', document.mimeType)
  res.setHeader('Cache-Control', 'private, no-store')
  res.end(buffer)
}

export default handler
