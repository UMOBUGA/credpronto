import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../_lib/db'
import {
  antifraudChecks,
  applicants,
  applications,
  bureauChecks,
  documents,
  vehicleChecks,
} from '../_lib/schema'
import { decryptField } from '../_lib/crypto'
import { requireDealerSession } from '../_lib/auth'
import { transition } from '../_lib/stateMachine'
import { checkBureauMock } from '../_lib/bureau'
import { lookupFipeValue } from '../_lib/fipe'
import { checkVehicleRestrictionMock } from '../_lib/vehicleRestriction'
import { checkAntifraud } from '../_lib/antifraud'
import { getLatestExtraction } from '../_lib/documentExtraction'
import { readJsonBody, sendJson, type Handler } from '../_lib/http'

const bodySchema = z.object({ applicationId: z.string().uuid() })
const READY_STATUSES = new Set(['client_submitted', 'documents_review_required'])

/**
 * Um documento bloqueia o avanço da esteira se a extração nunca terminou
 * (`failed`), ainda está rodando, ou terminou mas precisa de revisão humana
 * (`needs_review`/`rejected` na última tentativa). Olha só a extração mais
 * recente de cada documento — um retry bem-sucedido desbloqueia mesmo com
 * tentativas anteriores malsucedidas no histórico.
 */
async function hasBlockingDocument(
  db: Awaited<ReturnType<typeof getDb>>,
  applicationId: string,
): Promise<boolean> {
  const docs = await db.select().from(documents).where(eq(documents.applicationId, applicationId))
  if (docs.length === 0) return true

  for (const doc of docs) {
    if (doc.status !== 'extracted') return true
    const latest = await getLatestExtraction(db, doc.id)
    if (!latest || latest.status === 'needs_review' || latest.status === 'rejected') return true
  }

  return false
}

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
  if (!READY_STATUSES.has(application.status)) {
    sendJson(res, 409, { error: 'not_ready', status: application.status })
    return
  }

  const actor = { actorType: 'dealer_user' as const, actorId: user.id }

  if (application.status === 'client_submitted') {
    await transition(db, applicationId, 'processing_documents', actor)
  }

  if (await hasBlockingDocument(db, applicationId)) {
    if (application.status !== 'documents_review_required') {
      await transition(db, applicationId, 'documents_review_required', actor)
    }
    sendJson(res, 200, { status: 'documents_review_required' })
    return
  }

  await transition(db, applicationId, 'documents_verified', actor)
  await transition(db, applicationId, 'awaiting_openfinance_consent', actor)
  await transition(db, applicationId, 'openfinance_failed', actor)
  await transition(db, applicationId, 'running_checks', actor)

  const [applicant] = await db
    .select()
    .from(applicants)
    .where(eq(applicants.id, application.applicantId))
    .limit(1)
  if (!applicant) {
    sendJson(res, 500, { error: 'applicant_missing' })
    return
  }

  const declaredCpf = await decryptField(applicant.cpfEncrypted, {
    db,
    actor,
    entityType: 'applicant',
    entityId: applicant.id,
    field: 'cpf',
    applicationId,
  })
  const declaredFullName = await decryptField(applicant.fullNameEncrypted, {
    db,
    actor,
    entityType: 'applicant',
    entityId: applicant.id,
    field: 'fullName',
    applicationId,
  })
  const birthDate = applicant.birthDateEncrypted
    ? await decryptField(applicant.birthDateEncrypted, {
        db,
        actor,
        entityType: 'applicant',
        entityId: applicant.id,
        field: 'birthDate',
        applicationId,
      })
    : null

  // Bureau (simulado)
  const bureauResult = checkBureauMock(declaredCpf)
  const [bureauCheck] = await db
    .insert(bureauChecks)
    .values({
      applicationId,
      score: bureauResult.score,
      hasRestriction: bureauResult.hasRestriction,
      restrictionDetailsJson: bureauResult.restrictionDetails,
      rawResponseJson: bureauResult,
    })
    .returning()

  // Consulta veicular (FIPE real + restrição simulada)
  const fipe = await lookupFipeValue(
    application.vehicleMake,
    application.vehicleModel,
    application.vehicleYear,
  )
  const restriction = checkVehicleRestrictionMock(application.vehiclePlate)
  const [vehicleCheck] = await db
    .insert(vehicleChecks)
    .values({
      applicationId,
      fipeValue: fipe.fipeValue,
      fipeCode: fipe.fipeCode,
      fipeBrand: fipe.fipeBrand,
      fipeModel: fipe.fipeModel,
      fipeYear: fipe.fipeYear,
      restrictionFound: restriction.restrictionFound,
      restrictionDetailsJson: restriction.restrictionDetails,
      source: 'brasilapi-fipe+mock-detran',
    })
    .returning()

  // Anti-fraude: cruza o declarado com o que a IA extraiu de qualquer
  // documento de identidade já aceito (auto_accepted/reviewed).
  const docs = await db.select().from(documents).where(eq(documents.applicationId, applicationId))
  let extractedCpf: string | null = null
  let extractedFullName: string | null = null
  for (const doc of docs) {
    const extraction = await getLatestExtraction(db, doc.id)
    if (!extraction || extraction.status === 'needs_review' || extraction.status === 'rejected') {
      continue
    }
    const fields = JSON.parse(
      await decryptField(extraction.extractedFieldsEncrypted, {
        db,
        actor,
        entityType: 'document',
        entityId: doc.id,
        field: 'extractedFields',
        applicationId,
      }),
    ) as Record<string, string>
    if (!extractedCpf && fields.cpf) extractedCpf = fields.cpf.replace(/\D/g, '')
    if (!extractedFullName && fields.nome) extractedFullName = fields.nome
  }

  const antifraudResult = checkAntifraud({
    declaredCpf,
    declaredFullName,
    extractedCpf,
    extractedFullName,
    birthDate,
  })
  const [antifraudCheck] = await db
    .insert(antifraudChecks)
    .values({
      applicationId,
      riskScore: antifraudResult.riskScore,
      flagsJson: antifraudResult.flags,
      provider: antifraudResult.provider,
    })
    .returning()

  sendJson(res, 201, { bureauCheck, vehicleCheck, antifraudCheck })
}

export default handler
