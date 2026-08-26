import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../_lib/db'
import { applicants, applications, type ApplicationStatus } from '../_lib/schema'
import { encryptField, hashForLookup } from '../_lib/crypto'
import { generateClientPortalToken, requireDealerSession } from '../_lib/auth'
import { transition } from '../_lib/stateMachine'
import { readJsonBody, sendJson, type Handler } from '../_lib/http'

const CLIENT_LINK_TTL_DAYS = 7

const createSchema = z.object({
  applicant: z.object({
    fullName: z.string().min(1),
    cpf: z.string().min(11),
    phone: z.string().min(8),
    email: z.string().email(),
  }),
  vehicleMake: z.string().min(1),
  vehicleModel: z.string().min(1),
  vehicleYear: z.number().int(),
  vehiclePrice: z.number().positive(),
  vehiclePlate: z.string().min(7),
  downPayment: z.number().min(0).default(0),
  requestedAmount: z.number().positive(),
  requestedTermMonths: z.number().int().positive(),
})

async function handleList(res: Parameters<Handler>[1], db: Awaited<ReturnType<typeof getDb>>) {
  const rows = await db.select().from(applications).orderBy(desc(applications.createdAt)).limit(100)
  sendJson(res, 200, rows)
}

async function handleCreate(
  req: Parameters<Handler>[0],
  res: Parameters<Handler>[1],
  db: Awaited<ReturnType<typeof getDb>>,
  dealerUserId: string,
) {
  const parsed = createSchema.safeParse(await readJsonBody(req))
  if (!parsed.success) {
    sendJson(res, 400, { error: 'invalid_body', details: parsed.error.flatten() })
    return
  }
  const { applicant, ...vehicle } = parsed.data
  const cpfDigits = applicant.cpf.replace(/\D/g, '')
  const cpfHash = hashForLookup(cpfDigits)

  const [existing] = await db
    .select({ id: applicants.id })
    .from(applicants)
    .where(eq(applicants.cpfHash, cpfHash))
    .limit(1)

  const applicantId =
    existing?.id ??
    (
      await db
        .insert(applicants)
        .values({
          fullNameEncrypted: encryptField(applicant.fullName),
          cpfEncrypted: encryptField(cpfDigits),
          cpfHash,
          phoneEncrypted: encryptField(applicant.phone),
          emailEncrypted: encryptField(applicant.email),
        })
        .returning()
    )[0]!.id

  const clientPortalToken = generateClientPortalToken()
  const [application] = await db
    .insert(applications)
    .values({
      applicantId,
      dealerUserId,
      vehicleMake: vehicle.vehicleMake,
      vehicleModel: vehicle.vehicleModel,
      vehicleYear: vehicle.vehicleYear,
      vehiclePrice: vehicle.vehiclePrice,
      vehiclePlate: vehicle.vehiclePlate,
      downPayment: vehicle.downPayment,
      requestedAmount: vehicle.requestedAmount,
      requestedTermMonths: vehicle.requestedTermMonths,
      status: 'draft' satisfies ApplicationStatus,
      clientPortalToken,
      clientPortalTokenExpiresAt: new Date(Date.now() + CLIENT_LINK_TTL_DAYS * 24 * 60 * 60 * 1000),
    })
    .returning()

  await transition(db, application!.id, 'link_sent', {
    actorType: 'dealer_user',
    actorId: dealerUserId,
  })

  sendJson(res, 201, {
    ...application,
    status: 'link_sent',
    portalPath: `/portal/${clientPortalToken}`,
  })
}

const handler: Handler = async (req, res) => {
  const db = await getDb()
  const user = await requireDealerSession(req, res, db)
  if (!user) return

  if (req.method === 'POST') {
    await handleCreate(req, res, db, user.id)
    return
  }

  await handleList(res, db)
}

export default handler
