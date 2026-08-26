import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../_lib/db'
import {
  antifraudChecks,
  applicants,
  applications,
  bureauChecks,
  creditDecisions,
  documentExtractions,
  documents,
  loanOffers,
  vehicleChecks,
} from '../_lib/schema'
import { decryptField, type DecryptFieldContext } from '../_lib/crypto'
import { requireDealerSession } from '../_lib/auth'
import { logAction } from '../_lib/audit'
import { lastPathSegment, readJsonBody, sendJson, type Handler } from '../_lib/http'

const EDITABLE_STATUSES = new Set(['draft', 'link_sent', 'client_submitted'])

const patchSchema = z.object({
  vehicleMake: z.string().min(1).optional(),
  vehicleModel: z.string().min(1).optional(),
  vehicleYear: z.number().int().optional(),
  vehiclePrice: z.number().positive().optional(),
  downPayment: z.number().min(0).optional(),
  requestedAmount: z.number().positive().optional(),
  requestedTermMonths: z.number().int().positive().optional(),
})

async function handleGet(
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

  const [applicant] = await db
    .select()
    .from(applicants)
    .where(eq(applicants.id, application.applicantId))
    .limit(1)
  if (!applicant) {
    sendJson(res, 500, { error: 'applicant_missing' })
    return
  }

  const baseCtx: Omit<DecryptFieldContext, 'field'> = {
    db,
    actor: { actorType: 'dealer_user', actorId: dealerUserId },
    entityType: 'applicant',
    entityId: applicant.id,
    applicationId,
  }

  // Sequencial de propósito: PGlite é uma conexão única, e cada decrypt
  // grava em audit_log — melhor não competir por escrita concorrente aqui.
  const fullName = await decryptField(applicant.fullNameEncrypted, {
    ...baseCtx,
    field: 'fullName',
  })
  const cpf = await decryptField(applicant.cpfEncrypted, { ...baseCtx, field: 'cpf' })
  const phone = await decryptField(applicant.phoneEncrypted, { ...baseCtx, field: 'phone' })
  const email = await decryptField(applicant.emailEncrypted, { ...baseCtx, field: 'email' })
  const birthDate = applicant.birthDateEncrypted
    ? await decryptField(applicant.birthDateEncrypted, { ...baseCtx, field: 'birthDate' })
    : null
  const address = applicant.addressEncrypted
    ? JSON.parse(await decryptField(applicant.addressEncrypted, { ...baseCtx, field: 'address' }))
    : null
  const monthlyIncomeDeclared = applicant.monthlyIncomeDeclaredEncrypted
    ? Number(
        await decryptField(applicant.monthlyIncomeDeclaredEncrypted, {
          ...baseCtx,
          field: 'monthlyIncomeDeclared',
        }),
      )
    : null

  const docRows = await db
    .select()
    .from(documents)
    .where(eq(documents.applicationId, applicationId))
  const docs = []
  for (const doc of docRows) {
    const [latestExtraction] = await db
      .select()
      .from(documentExtractions)
      .where(eq(documentExtractions.documentId, doc.id))
      .orderBy(desc(documentExtractions.createdAt))
      .limit(1)

    let extraction = null
    if (latestExtraction) {
      const fields = JSON.parse(
        await decryptField(latestExtraction.extractedFieldsEncrypted, {
          ...baseCtx,
          entityType: 'document',
          entityId: doc.id,
          field: 'extractedFields',
        }),
      ) as Record<string, string>
      extraction = {
        id: latestExtraction.id,
        status: latestExtraction.status,
        confidenceScore: latestExtraction.confidenceScore,
        fields,
        reviewedAt: latestExtraction.reviewedAt,
      }
    }

    docs.push({ ...doc, extraction })
  }

  const [latestBureauCheck] = await db
    .select()
    .from(bureauChecks)
    .where(eq(bureauChecks.applicationId, applicationId))
    .orderBy(desc(bureauChecks.checkedAt))
    .limit(1)
  const [latestVehicleCheck] = await db
    .select()
    .from(vehicleChecks)
    .where(eq(vehicleChecks.applicationId, applicationId))
    .orderBy(desc(vehicleChecks.checkedAt))
    .limit(1)
  const [latestAntifraudCheck] = await db
    .select()
    .from(antifraudChecks)
    .where(eq(antifraudChecks.applicationId, applicationId))
    .orderBy(desc(antifraudChecks.checkedAt))
    .limit(1)
  const [latestDecision] = await db
    .select()
    .from(creditDecisions)
    .where(eq(creditDecisions.applicationId, applicationId))
    .orderBy(desc(creditDecisions.decidedAt))
    .limit(1)
  const offers = await db
    .select()
    .from(loanOffers)
    .where(eq(loanOffers.applicationId, applicationId))

  sendJson(res, 200, {
    ...application,
    applicant: {
      id: applicant.id,
      fullName,
      cpf,
      phone,
      email,
      birthDate,
      address,
      monthlyIncomeDeclared,
    },
    documents: docs,
    latestBureauCheck: latestBureauCheck ?? null,
    latestVehicleCheck: latestVehicleCheck ?? null,
    latestAntifraudCheck: latestAntifraudCheck ?? null,
    latestDecision: latestDecision ?? null,
    offers,
  })
}

async function handlePatch(
  req: Parameters<Handler>[0],
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
  if (!EDITABLE_STATUSES.has(application.status)) {
    sendJson(res, 409, { error: 'not_editable', status: application.status })
    return
  }

  const parsed = patchSchema.safeParse(await readJsonBody(req))
  if (!parsed.success) {
    sendJson(res, 400, { error: 'invalid_body', details: parsed.error.flatten() })
    return
  }
  if (Object.keys(parsed.data).length === 0) {
    sendJson(res, 200, application)
    return
  }

  const [updated] = await db
    .update(applications)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(applications.id, applicationId))
    .returning()

  await logAction(
    db,
    { actorType: 'dealer_user', actorId: dealerUserId },
    {
      action: 'application.updated',
      entityType: 'application',
      entityId: applicationId,
      applicationId,
      metadata: { fields: Object.keys(parsed.data) },
    },
  )

  sendJson(res, 200, updated)
}

const handler: Handler = async (req, res) => {
  const db = await getDb()
  const user = await requireDealerSession(req, res, db)
  if (!user) return

  const applicationId = lastPathSegment(req)

  if (req.method === 'PATCH') {
    await handlePatch(req, res, db, applicationId, user.id)
    return
  }
  await handleGet(res, db, applicationId, user.id)
}

export default handler
