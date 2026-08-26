import { desc, eq } from 'drizzle-orm'
import { getDb } from '../../_lib/db'
import { applications, auditLog } from '../../_lib/schema'
import { requireDealerSession } from '../../_lib/auth'
import { pathSegment, sendJson, type Handler } from '../../_lib/http'

const MAX_ROWS = 200

/**
 * Trilha de auditoria por proposta, pro dealer conferir quem acessou o quê.
 * Aberto a qualquer papel autenticado (diferente de `reveal.ts`) porque
 * `metadataJson` nunca carrega valor de PII por construção (ver
 * `audit.ts`) — o próprio log é seguro de mostrar.
 */
const handler: Handler = async (req, res) => {
  const db = await getDb()
  const user = await requireDealerSession(req, res, db)
  if (!user) return

  const applicationId = pathSegment(req, 1)
  const [application] = await db
    .select({ id: applications.id })
    .from(applications)
    .where(eq(applications.id, applicationId))
    .limit(1)
  if (!application) {
    sendJson(res, 404, { error: 'not_found' })
    return
  }

  const entries = await db
    .select()
    .from(auditLog)
    .where(eq(auditLog.applicationId, applicationId))
    .orderBy(desc(auditLog.occurredAt))
    .limit(MAX_ROWS)

  sendJson(res, 200, entries, 'no-store')
}

export default handler
