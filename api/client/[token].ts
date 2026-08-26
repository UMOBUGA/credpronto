import { eq } from 'drizzle-orm'
import { getDb } from '../_lib/db'
import { applicants, documents } from '../_lib/schema'
import { requireApplicationByToken } from '../_lib/auth'
import { lastPathSegment, sendJson, type Handler } from '../_lib/http'

/**
 * View do cliente é deliberadamente magra: status, dados do veículo, se já
 * preencheu os dados pessoais e a lista de documentos (tipo/status, nunca o
 * conteúdo). Nenhum campo cifrado é decriptado aqui — o portal do cliente
 * não precisa reexibir o que o próprio cliente digitou.
 */
const handler: Handler = async (req, res) => {
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

  sendJson(res, 200, {
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
  })
}

export default handler
