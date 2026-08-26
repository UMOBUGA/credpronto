import { desc, eq } from 'drizzle-orm'
import { getDb } from '../../_lib/db'
import { applicants, applications, bureauChecks, creditDecisions } from '../../_lib/schema'
import { decryptField } from '../../_lib/crypto'
import { requireDealerSession } from '../../_lib/auth'
import { transition } from '../../_lib/stateMachine'
import { decide } from '../../_lib/decision'
import { pathSegment, sendJson, type Handler } from '../../_lib/http'

async function handleGet(
  res: Parameters<Handler>[1],
  db: Awaited<ReturnType<typeof getDb>>,
  applicationId: string,
) {
  const [decision] = await db
    .select()
    .from(creditDecisions)
    .where(eq(creditDecisions.applicationId, applicationId))
    .orderBy(desc(creditDecisions.decidedAt))
    .limit(1)
  sendJson(res, 200, decision ?? null)
}

/**
 * Roda o motor determinístico (`decision.ts::decide`) — nunca a IA. A IA só
 * entra na Fase 3, gerando um parecer que EXPLICA esta decisão depois de
 * tomada, nunca a substitui.
 */
async function handlePost(
  res: Parameters<Handler>[1],
  db: Awaited<ReturnType<typeof getDb>>,
  applicationId: string,
  dealerUserId: string,
) {
  const [application] = await db
    .select()
    .from(applications)
    .where(eq(applications.id, applicationId))
    .limit(1)
  if (!application) {
    sendJson(res, 404, { error: 'not_found' })
    return
  }
  if (application.status !== 'running_checks') {
    sendJson(res, 409, { error: 'not_ready', status: application.status })
    return
  }

  const [bureauCheck] = await db
    .select()
    .from(bureauChecks)
    .where(eq(bureauChecks.applicationId, applicationId))
    .orderBy(desc(bureauChecks.checkedAt))
    .limit(1)
  if (!bureauCheck) {
    sendJson(res, 409, { error: 'no_bureau_check' })
    return
  }

  const [applicant] = await db
    .select()
    .from(applicants)
    .where(eq(applicants.id, application.applicantId))
    .limit(1)
  if (!applicant) {
    sendJson(res, 500, { error: 'applicant_missing' })
    return
  }

  const actor = { actorType: 'dealer_user' as const, actorId: dealerUserId }
  const monthlyIncomeDeclared = applicant.monthlyIncomeDeclaredEncrypted
    ? Number(
        await decryptField(applicant.monthlyIncomeDeclaredEncrypted, {
          db,
          actor,
          entityType: 'applicant',
          entityId: applicant.id,
          field: 'monthlyIncomeDeclared',
          applicationId,
        }),
      )
    : 0

  const result = decide({
    bureauScore: bureauCheck.score,
    hasBureauRestriction: bureauCheck.hasRestriction,
    requestedAmount: application.requestedAmount,
    monthlyIncomeDeclared,
    requestedTermMonths: application.requestedTermMonths,
  })

  const [decision] = await db
    .insert(creditDecisions)
    .values({
      applicationId,
      outcome: result.outcome,
      scoreUsed: result.scoreUsed,
      factorsJson: result.factors,
    })
    .returning()

  await transition(db, applicationId, result.outcome, actor)

  sendJson(res, 201, decision)
}

const handler: Handler = async (req, res) => {
  const db = await getDb()
  const user = await requireDealerSession(req, res, db)
  if (!user) return
  const applicationId = pathSegment(req, 1)

  if (req.method === 'POST') {
    await handlePost(res, db, applicationId, user.id)
    return
  }
  await handleGet(res, db, applicationId)
}

export default handler
