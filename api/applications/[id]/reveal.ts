import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../../_lib/db'
import { applicants, applications } from '../../_lib/schema'
import { decryptField } from '../../_lib/crypto'
import { requireDealerRole } from '../../_lib/auth'
import { pathSegment, readJsonBody, sendJson, type Handler } from '../../_lib/http'

const REVEALABLE_FIELDS = ['cpf', 'monthlyIncomeDeclared'] as const
const bodySchema = z.object({ field: z.enum(REVEALABLE_FIELDS) })

/**
 * Único jeito de ver CPF/renda declarada em claro no portal do dealer —
 * `applications/[id].ts` devolve os dois mascarados desde a Fase 6 (ver
 * comentário lá). Restrito a admin/manager: um analyst opera a esteira
 * inteira (rodar checagem, decidir, gerar oferta) sem precisar disso.
 * Cada chamada grava `pii.revealed` em vez do `pii.decrypted` genérico —
 * distingue "sistema precisou decriptar pra calcular algo" de "um humano
 * clicou em revelar".
 */
const handler: Handler = async (req, res) => {
  const db = await getDb()
  const user = await requireDealerRole(req, res, db, ['admin', 'manager'])
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

  const parsed = bodySchema.safeParse(await readJsonBody(req))
  if (!parsed.success) {
    sendJson(res, 400, { error: 'invalid_body' })
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

  const ctx = {
    db,
    actor: { actorType: 'dealer_user' as const, actorId: user.id },
    entityType: 'applicant',
    entityId: applicant.id,
    applicationId,
    action: 'pii.revealed',
  }

  if (parsed.data.field === 'cpf') {
    const cpf = await decryptField(applicant.cpfEncrypted, { ...ctx, field: 'cpf' })
    sendJson(res, 200, { field: 'cpf', value: cpf }, 'no-store')
    return
  }

  if (!applicant.monthlyIncomeDeclaredEncrypted) {
    sendJson(res, 200, { field: 'monthlyIncomeDeclared', value: null }, 'no-store')
    return
  }
  const monthlyIncomeDeclared = Number(
    await decryptField(applicant.monthlyIncomeDeclaredEncrypted, {
      ...ctx,
      field: 'monthlyIncomeDeclared',
    }),
  )
  sendJson(res, 200, { field: 'monthlyIncomeDeclared', value: monthlyIncomeDeclared }, 'no-store')
}

export default handler
