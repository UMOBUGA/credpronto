import { desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../_lib/db'
import { applicants, applications, type ApplicationStatus } from '../_lib/schema'
import { encryptField, hashForLookup } from '../_lib/crypto'
import { generateClientPortalToken, requireDealerSession } from '../_lib/auth'
import { transition } from '../_lib/stateMachine'
import { getUrl, readJsonBody, sendJson, type Handler } from '../_lib/http'

const CLIENT_LINK_TTL_DAYS = 7
const PAGE_SIZE = 25

// Mesmos agrupamentos que os chips da fila usavam no frontend (Fase 10) —
// movidos pro backend na Fase 12 porque com paginação um chip calculado só
// em cima da página carregada ficaria enganoso (ex.: "1 aprovada" quando na
// verdade há mais em outras páginas). Uma contagem `GROUP BY status` cobre
// a tabela inteira, não só a página atual.
const REVIEW_STATUSES = new Set<ApplicationStatus>(['manual_review', 'documents_review_required'])
const SUCCESS_STATUSES = new Set<ApplicationStatus>([
  'approved',
  'offer_created',
  'offer_sent',
  'offer_accepted',
])
const CLOSED_STATUSES = new Set<ApplicationStatus>([
  'denied',
  'offer_declined',
  'cancelled',
  'expired',
])

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

/**
 * Paginada por offset (`?page=`, padrão simples o bastante pro volume de um
 * projeto de portfólio — sem cursor, sem índice extra). Antes disso a lista
 * cortava fixo em 100 registros sem nenhum jeito de ver o resto.
 */
async function handleList(
  req: Parameters<Handler>[0],
  res: Parameters<Handler>[1],
  db: Awaited<ReturnType<typeof getDb>>,
) {
  const pageParam = Number(getUrl(req).searchParams.get('page'))
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1
  const offset = (page - 1) * PAGE_SIZE

  const [items, statusCounts] = await Promise.all([
    db
      .select()
      .from(applications)
      .orderBy(desc(applications.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    db
      .select({ status: applications.status, count: sql<number>`count(*)::int` })
      .from(applications)
      .groupBy(applications.status),
  ])

  let total = 0
  let reviewing = 0
  let approved = 0
  let closed = 0
  for (const row of statusCounts) {
    total += row.count
    if (REVIEW_STATUSES.has(row.status)) reviewing += row.count
    if (SUCCESS_STATUSES.has(row.status)) approved += row.count
    if (CLOSED_STATUSES.has(row.status)) closed += row.count
  }

  sendJson(res, 200, {
    items,
    page,
    pageSize: PAGE_SIZE,
    hasMore: offset + items.length < total,
    stats: { total, reviewing, approved, closed },
  })
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

  await handleList(req, res, db)
}

export default handler
