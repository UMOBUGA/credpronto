import { desc, eq } from 'drizzle-orm'
import { getDb } from '../_lib/db'
import { applicants, creditDecisions, documents } from '../_lib/schema'
import { requireApplicationByToken } from '../_lib/auth'
import { enforceRateLimit } from '../_lib/rateLimit'
import { lastPathSegment, sendJson, type Handler } from '../_lib/http'

/**
 * View do cliente é deliberadamente magra: status, dados do veículo, se já
 * preencheu os dados pessoais e a lista de documentos (tipo/status, nunca o
 * conteúdo). Nenhum campo cifrado é decriptado aqui — o portal do cliente
 * não precisa reexibir o que o próprio cliente digitou.
 */
const handler: Handler = async (req, res) => {
  if (!enforceRateLimit(req, res, 'client.token', 60, 60 * 1000)) return

  const db = await getDb()
  const token = lastPathSegment(req)
  const application = await requireApplicationByToken(res, db, token)
  if (!application) return

  const [applicant] = await db
    .select({ birthDateEncrypted: applicants.birthDateEncrypted })
    .from(applicants)
    .where(eq(applicants.id, application.applicantId))
    .limit(1)

  const docs = await db
    .select({ id: documents.id, type: documents.type, status: documents.status })
    .from(documents)
    .where(eq(documents.applicationId, application.id))

  // Só o parecer em linguagem simples, nunca o técnico (fatores/scores
  // internos são informação do dealer, não do cliente).
  const [decision] = await db
    .select({
      outcome: creditDecisions.outcome,
      riskNarrativeApplicant: creditDecisions.riskNarrativeApplicant,
    })
    .from(creditDecisions)
    .where(eq(creditDecisions.applicationId, application.id))
    .orderBy(desc(creditDecisions.decidedAt))
    .limit(1)

  sendJson(
    res,
    200,
    {
      status: application.status,
      vehicle: {
        make: application.vehicleMake,
        model: application.vehicleModel,
        year: application.vehicleYear,
        price: application.vehiclePrice,
      },
      requestedAmount: application.requestedAmount,
      requestedTermMonths: application.requestedTermMonths,
      hasSubmittedDetails: Boolean(applicant?.birthDateEncrypted),
      documents: docs,
      decision: decision ?? null,
    },
    'no-store',
  )
}

export default handler
