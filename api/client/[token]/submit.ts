import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../../_lib/db'
import { applicants, consentRecords } from '../../_lib/schema'
import { encryptField } from '../../_lib/crypto'
import { requireApplicationByToken } from '../../_lib/auth'
import { transition } from '../../_lib/stateMachine'
import { enforceRateLimit } from '../../_lib/rateLimit'
import { pathSegment, readJsonBody, sendJson, type Handler } from '../../_lib/http'

/** Versão do texto de política mostrado ao cliente no momento do consentimento. */
const PRIVACY_POLICY_VERSION = '2026-08-26'

const bodySchema = z.object({
  birthDate: z.string().min(1),
  address: z.object({
    street: z.string().min(1),
    number: z.string().min(1),
    city: z.string().min(1),
    state: z.string().length(2),
    zip: z.string().min(1),
  }),
  monthlyIncomeDeclared: z.number().positive(),
  consent: z.literal(true),
  // Granulares (Fase 6) — distintos do consentimento geral de tratamento de
  // dado acima, que continua obrigatório. Nenhum dos dois bloqueia o envio:
  // não autorizar bureau/parecer de IA é uma escolha legítima do titular,
  // só limita o que a esteira consegue fazer depois (ver `decision.ts`/
  // `riskNarrative.ts`, que já toleram ausência de dado por design).
  consentBureauCheck: z.boolean().default(false),
  consentAiNarrativeShare: z.boolean().default(false),
})

const handler: Handler = async (req, res) => {
  if (!enforceRateLimit(req, res, 'client.submit', 20, 60 * 1000)) return

  const db = await getDb()
  const token = pathSegment(req, 1)
  const application = await requireApplicationByToken(res, db, token)
  if (!application) return

  if (application.status !== 'link_sent') {
    sendJson(res, 409, { error: 'not_ready', status: application.status })
    return
  }

  const parsed = bodySchema.safeParse(await readJsonBody(req))
  if (!parsed.success) {
    sendJson(res, 400, { error: 'invalid_body', details: parsed.error.flatten() })
    return
  }

  await db
    .update(applicants)
    .set({
      birthDateEncrypted: encryptField(parsed.data.birthDate),
      addressEncrypted: encryptField(JSON.stringify(parsed.data.address)),
      monthlyIncomeDeclaredEncrypted: encryptField(String(parsed.data.monthlyIncomeDeclared)),
      updatedAt: new Date(),
    })
    .where(eq(applicants.id, application.applicantId))

  const grantedConsentTypes: Array<'data_processing' | 'bureau_check' | 'ai_narrative_share'> = [
    'data_processing',
    ...(parsed.data.consentBureauCheck ? (['bureau_check'] as const) : []),
    ...(parsed.data.consentAiNarrativeShare ? (['ai_narrative_share'] as const) : []),
  ]
  await db.insert(consentRecords).values(
    grantedConsentTypes.map((consentType) => ({
      applicantId: application.applicantId,
      applicationId: application.id,
      consentType,
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    })),
  )

  await transition(db, application.id, 'client_submitted', {
    actorType: 'applicant',
    actorId: application.applicantId,
  })

  sendJson(res, 200, { status: 'client_submitted' })
}

export default handler
