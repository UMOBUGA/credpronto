import { desc, eq } from 'drizzle-orm'
import { getDb } from '../../_lib/db'
import { creditDecisions } from '../../_lib/schema'
import { requireDealerSession } from '../../_lib/auth'
import { generateAndSaveNarrative } from '../../_lib/riskNarrative'
import { pathSegment, sendJson, type Handler } from '../../_lib/http'

/**
 * Retry manual do parecer — usado quando a geração inline em
 * `POST /api/applications/[id]/decision` falhou (rede, API fora do ar,
 * saída malformada). Não recalcula a decisão, só tenta explicar de novo a
 * que já existe.
 */
const handler: Handler = async (req, res) => {
  const db = await getDb()
  const user = await requireDealerSession(req, res, db)
  if (!user) return

  const applicationId = pathSegment(req, 1)
  const [decision] = await db
    .select()
    .from(creditDecisions)
    .where(eq(creditDecisions.applicationId, applicationId))
    .orderBy(desc(creditDecisions.decidedAt))
    .limit(1)
  if (!decision) {
    sendJson(res, 404, { error: 'no_decision' })
    return
  }

  const result = await generateAndSaveNarrative(db, decision.id)
  if (!result.generated) {
    sendJson(res, 502, { error: 'narrative_failed' })
    return
  }

  const [updated] = await db
    .select()
    .from(creditDecisions)
    .where(eq(creditDecisions.id, decision.id))
    .limit(1)
  sendJson(res, 200, updated)
}

export default handler
