import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '../../_lib/db'
import {
  antifraudChecks,
  applicants,
  applications,
  bureauChecks,
  creditDecisions,
  openfinanceConsents,
  openfinanceData,
  vehicleChecks,
} from '../../_lib/schema'
import { decryptField } from '../../_lib/crypto'
import { requireDealerSession } from '../../_lib/auth'
import { transition } from '../../_lib/stateMachine'
import { decide } from '../../_lib/decision'
import { generateAndSaveNarrative } from '../../_lib/riskNarrative'
import { notify } from '../../_lib/notifications'
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
 * Roda o motor determinístico (`decision.ts::decide`) — nunca a IA. Só
 * depois da decisão estar persistida é que tenta gerar o parecer
 * (`generateAndSaveNarrative`), que EXPLICA a decisão, nunca a substitui.
 * A chamada de parecer roda de forma síncrona aqui (mesma justificativa da
 * Fase 2: funções Vercel Node não têm um jeito portável de continuar
 * trabalhando depois de `res.end()`), mas nunca falha a requisição — se a
 * IA não responder, a decisão persiste sem parecer e o dealer pode tentar
 * de novo via `POST /api/applications/[id]/narrative`.
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

  const [vehicleCheck] = await db
    .select()
    .from(vehicleChecks)
    .where(eq(vehicleChecks.applicationId, applicationId))
    .orderBy(desc(vehicleChecks.checkedAt))
    .limit(1)
  if (!vehicleCheck) {
    sendJson(res, 409, { error: 'no_vehicle_check' })
    return
  }

  const [antifraudCheck] = await db
    .select()
    .from(antifraudChecks)
    .where(eq(antifraudChecks.applicationId, applicationId))
    .orderBy(desc(antifraudChecks.checkedAt))
    .limit(1)
  if (!antifraudCheck) {
    sendJson(res, 409, { error: 'no_antifraud_check' })
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

  // Open Finance (simulado) é opcional — consentimento negado é legítimo e
  // comum, não deve bloquear a esteira nem penalizar a decisão (ver
  // decision.ts). `openfinanceVerified` só fica true quando o cliente de
  // fato autorizou.
  const [latestConsent] = await db
    .select()
    .from(openfinanceConsents)
    .where(eq(openfinanceConsents.applicationId, applicationId))
    .orderBy(desc(openfinanceConsents.createdAt))
    .limit(1)
  const openfinanceVerified = latestConsent?.status === 'authorized'
  let openfinanceIncomeEstimate: number | null = null
  if (openfinanceVerified && latestConsent) {
    const [incomeRow] = await db
      .select()
      .from(openfinanceData)
      .where(
        and(
          eq(openfinanceData.consentId, latestConsent.id),
          eq(openfinanceData.dataType, 'income'),
        ),
      )
      .limit(1)
    if (incomeRow) {
      openfinanceIncomeEstimate = Number(
        await decryptField(incomeRow.payloadEncrypted, {
          db,
          actor,
          entityType: 'openfinance_data',
          entityId: incomeRow.id,
          field: 'monthlyIncomeEstimate',
          applicationId,
        }),
      )
    }
  }

  const result = decide({
    bureauScore: bureauCheck.score,
    hasBureauRestriction: bureauCheck.hasRestriction,
    requestedAmount: application.requestedAmount,
    monthlyIncomeDeclared,
    requestedTermMonths: application.requestedTermMonths,
    vehicleRestrictionFound: vehicleCheck.restrictionFound,
    fipeValue: vehicleCheck.fipeValue,
    antifraudRiskScore: antifraudCheck.riskScore,
    antifraudFlags: antifraudCheck.flagsJson as string[],
    openfinanceVerified,
    openfinanceIncomeEstimate,
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

  // `manual_review` ainda não é uma decisão pra avisar o cliente — não há
  // nada de novo pra ele saber até um humano resolver (ver resolve.ts, que
  // sempre notifica porque só produz approved/denied).
  if (result.outcome !== 'manual_review') {
    await notify(db, applicationId, 'decision_ready')
  }

  await generateAndSaveNarrative(db, decision!.id)
  const [decisionWithNarrative] = await db
    .select()
    .from(creditDecisions)
    .where(eq(creditDecisions.id, decision!.id))
    .limit(1)

  sendJson(res, 201, decisionWithNarrative)
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
