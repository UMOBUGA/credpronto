import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../../_lib/db'
import { applications, creditDecisions } from '../../_lib/schema'
import { requireDealerSession } from '../../_lib/auth'
import { transition } from '../../_lib/stateMachine'
import { pathSegment, readJsonBody, sendJson, type Handler } from '../../_lib/http'

const bodySchema = z.object({ outcome: z.enum(['approved', 'denied']) })

/**
 * Só usado quando o motor determinístico (`decision.ts`) devolveu
 * `manual_review` — a resolução humana grava uma NOVA linha em
 * `credit_decisions` (nunca sobrescreve a do motor), preservando o
 * histórico de "o motor disse X, o humano decidiu Y".
 */
const handler: Handler = async (req, res) => {
  const db = await getDb()
  const user = await requireDealerSession(req, res, db)
  if (!user) return

  const applicationId = pathSegment(req, 1)
  const [application] = await db
    .select()
    .from(applications)
    .where(eq(applications.id, applicationId))
    .limit(1)
  if (!application) {
    sendJson(res, 404, { error: 'not_found' })
    return
  }
  if (application.status !== 'manual_review') {
    sendJson(res, 409, { error: 'not_in_manual_review', status: application.status })
    return
  }

  const parsed = bodySchema.safeParse(await readJsonBody(req))
  if (!parsed.success) {
    sendJson(res, 400, { error: 'invalid_body' })
    return
  }

  const [previous] = await db
    .select()
    .from(creditDecisions)
    .where(eq(creditDecisions.applicationId, applicationId))
    .orderBy(desc(creditDecisions.decidedAt))
    .limit(1)
  if (!previous) {
    sendJson(res, 500, { error: 'no_prior_decision' })
    return
  }

  const [decision] = await db
    .insert(creditDecisions)
    .values({
      applicationId,
      outcome: parsed.data.outcome,
      scoreUsed: previous.scoreUsed,
      factorsJson: previous.factorsJson,
      decidedBy: user.id,
    })
    .returning()

  await transition(db, applicationId, parsed.data.outcome, {
    actorType: 'dealer_user',
    actorId: user.id,
  })

  sendJson(res, 200, decision)
}

export default handler
