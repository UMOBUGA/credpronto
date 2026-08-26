import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../../_lib/db'
import { applicants, consentRecords, openfinanceConsents, openfinanceData } from '../../_lib/schema'
import { decryptField, encryptField } from '../../_lib/crypto'
import { requireApplicationByToken } from '../../_lib/auth'
import { transition } from '../../_lib/stateMachine'
import { getOpenFinanceClient } from '../../_lib/openfinance'
import { enforceRateLimit } from '../../_lib/rateLimit'
import { pathSegment, readJsonBody, sendJson, type Handler } from '../../_lib/http'

const bodySchema = z.object({ decision: z.enum(['authorize', 'deny']) })
const SCOPES = ['accounts', 'transactions']
/** Mesma versão de política usada pelos outros consentimentos do portal do cliente. */
const PRIVACY_POLICY_VERSION = '2026-08-26'

/**
 * Cria o consentimento e — se autorizado — já busca e salva o dado numa
 * chamada só. Uma integração real do Open Finance teria um redirecionamento
 * de ida e volta pro banco (`initiateConsent` aqui, `authorize` num
 * callback separado depois do usuário agir na tela do banco); como este
 * fluxo é inteiramente simulado (ver `openfinance.ts` e CLAUDE.md — não há
 * banco de sandbox acessível), não existe uma ida real pra simular, então
 * as duas etapas colapsam numa requisição só sem perder o formato de dado
 * de uma integração real (consentimento e dado ainda são duas tabelas
 * distintas).
 */
const handler: Handler = async (req, res) => {
  if (!enforceRateLimit(req, res, 'client.openfinance', 20, 60 * 1000)) return

  const db = await getDb()
  const token = pathSegment(req, 1)
  const application = await requireApplicationByToken(res, db, token)
  if (!application) return

  if (application.status !== 'awaiting_openfinance_consent') {
    sendJson(res, 409, { error: 'not_ready', status: application.status })
    return
  }

  const parsed = bodySchema.safeParse(await readJsonBody(req))
  if (!parsed.success) {
    sendJson(res, 400, { error: 'invalid_body' })
    return
  }

  const actor = { actorType: 'applicant' as const, actorId: application.applicantId }

  if (parsed.data.decision === 'deny') {
    await db.insert(openfinanceConsents).values({
      applicationId: application.id,
      providerConsentId: `denied-${application.id}`,
      status: 'rejected',
      scopesJson: SCOPES,
    })
    await transition(db, application.id, 'openfinance_failed', actor)
    sendJson(res, 200, { status: 'openfinance_failed' })
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

  const cpf = await decryptField(applicant.cpfEncrypted, {
    db,
    actor,
    entityType: 'applicant',
    entityId: applicant.id,
    field: 'cpf',
    applicationId: application.id,
  })

  const client = getOpenFinanceClient()

  try {
    const { providerConsentId } = await client.initiateConsent(cpf)
    const tokens = await client.authorize(providerConsentId)
    const data = await client.fetchAccountData(tokens.accessToken, cpf)

    const [consent] = await db
      .insert(openfinanceConsents)
      .values({
        applicationId: application.id,
        providerConsentId,
        status: 'authorized',
        scopesJson: SCOPES,
        accessTokenEncrypted: encryptField(tokens.accessToken),
        refreshTokenEncrypted: encryptField(tokens.refreshToken),
        authorizedAt: new Date(),
        expiresAt: tokens.expiresAt,
      })
      .returning()

    await db.insert(openfinanceData).values([
      {
        consentId: consent!.id,
        dataType: 'accounts',
        payloadEncrypted: encryptField(JSON.stringify(data.accounts)),
      },
      {
        consentId: consent!.id,
        dataType: 'transactions',
        payloadEncrypted: encryptField(JSON.stringify(data.transactions)),
      },
      {
        consentId: consent!.id,
        dataType: 'income',
        payloadEncrypted: encryptField(String(data.monthlyIncomeEstimate)),
      },
    ])

    await db.insert(consentRecords).values({
      applicantId: application.applicantId,
      applicationId: application.id,
      consentType: 'openfinance_share',
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    })

    await transition(db, application.id, 'openfinance_authorized', actor)
    sendJson(res, 200, { status: 'openfinance_authorized' })
  } catch {
    // Nunca deveria acontecer com o mock, mas se OPENFINANCE_ENABLED for
    // ligado sem uma implementação real (RealOpenFinanceClient sempre
    // lança), degrada pro mesmo caminho de "sem dado" — não derruba a
    // requisição, e a ausência de dado do Open Finance não penaliza a
    // decisão (ver decision.ts).
    await db.insert(openfinanceConsents).values({
      applicationId: application.id,
      providerConsentId: `error-${application.id}`,
      status: 'rejected',
      scopesJson: SCOPES,
    })
    await transition(db, application.id, 'openfinance_failed', actor)
    sendJson(res, 200, { status: 'openfinance_failed' })
  }
}

export default handler
