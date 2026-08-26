import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../_lib/db'
import { applicants, applications, bureauChecks } from '../_lib/schema'
import { decryptField } from '../_lib/crypto'
import { requireDealerSession } from '../_lib/auth'
import { transition } from '../_lib/stateMachine'
import { checkBureauMock } from '../_lib/bureau'
import { readJsonBody, sendJson, type Handler } from '../_lib/http'

const bodySchema = z.object({ applicationId: z.string().uuid() })

/**
 * As Fases 2 (extração de documento por IA) e 4 (Open Finance real) ainda
 * não existem, então aqui a proposta atravessa
 * documents_verified/awaiting_openfinance_consent/openfinance_failed em
 * sequência automática — sem lógica própria por trás dessas etapas ainda,
 * mas cada hop passa por `transition()`, então o rastro de auditoria fica
 * completo desde já. Quando a Fase 2/4 chegar, esses hops passam a ser
 * disparados por eventos reais em vez deste laço.
 */
const AUTO_HOPS = [
  'processing_documents',
  'documents_verified',
  'awaiting_openfinance_consent',
  'openfinance_failed',
  'running_checks',
] as const

const handler: Handler = async (req, res) => {
  const db = await getDb()
  const user = await requireDealerSession(req, res, db)
  if (!user) return

  const parsed = bodySchema.safeParse(await readJsonBody(req))
  if (!parsed.success) {
    sendJson(res, 400, { error: 'invalid_body' })
    return
  }

  const { applicationId } = parsed.data
  const [application] = await db
    .select()
    .from(applications)
    .where(eq(applications.id, applicationId))
    .limit(1)
  if (!application) {
    sendJson(res, 404, { error: 'not_found' })
    return
  }
  if (application.status !== 'client_submitted') {
    sendJson(res, 409, { error: 'not_ready', status: application.status })
    return
  }

  const actor = { actorType: 'dealer_user' as const, actorId: user.id }
  for (const hop of AUTO_HOPS) {
    await transition(db, applicationId, hop, actor)
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

  const cpf = await decryptField(applicant.cpfEncrypted, {
    db,
    actor,
    entityType: 'applicant',
    entityId: applicant.id,
    field: 'cpf',
    applicationId,
  })

  const result = checkBureauMock(cpf)
  const [check] = await db
    .insert(bureauChecks)
    .values({
      applicationId,
      score: result.score,
      hasRestriction: result.hasRestriction,
      restrictionDetailsJson: result.restrictionDetails,
      rawResponseJson: result,
    })
    .returning()

  sendJson(res, 201, check)
}

export default handler
