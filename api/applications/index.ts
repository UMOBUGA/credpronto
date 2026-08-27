import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../_lib/db'
import {
  applicants,
  applications,
  applicationStatusEnum,
  type ApplicationStatus,
} from '../_lib/schema'
import { encryptField, hashForLookup } from '../_lib/crypto'
import { generateClientPortalToken, requireDealerSession } from '../_lib/auth'
import { transition } from '../_lib/stateMachine'
import { notify } from '../_lib/notifications'
import { getApplicationStatusCounts } from '../_lib/applicationStats'
import { getUrl, readJsonBody, sendJson, type Handler } from '../_lib/http'

const CLIENT_LINK_TTL_DAYS = 7
const PAGE_SIZE = 25

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

const STATUS_VALUES = new Set<string>(applicationStatusEnum.enumValues)

/**
 * Paginada por offset (`?page=`, padrão simples o bastante pro volume de um
 * projeto de portfólio — sem cursor, sem índice extra). Antes disso a lista
 * cortava fixo em 100 registros sem nenhum jeito de ver o resto.
 *
 * `?status=` (um valor exato do enum, silenciosamente ignorado se inválido)
 * e `?q=` (Fase 15) filtram a lista — mas nunca os chips de estatística
 * (`stats`), que continuam somando a tabela inteira: são dois conceitos
 * diferentes, "quantas propostas existem no total" não deveria mudar só
 * porque o dealer está filtrando a visão. `?q=` busca só em colunas não
 * criptografadas (marca/modelo/placa) — nome/CPF do titular são cifrados e
 * buscar neles exigiria decriptar linha a linha, fora de escopo aqui.
 */
async function handleList(
  req: Parameters<Handler>[0],
  res: Parameters<Handler>[1],
  db: Awaited<ReturnType<typeof getDb>>,
) {
  const params = getUrl(req).searchParams
  const pageParam = Number(params.get('page'))
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1
  const offset = (page - 1) * PAGE_SIZE

  const statusParam = params.get('status')
  const status = statusParam && STATUS_VALUES.has(statusParam) ? statusParam : null
  const q = params.get('q')?.trim() || null

  const filters = [
    status ? eq(applications.status, status as ApplicationStatus) : undefined,
    q
      ? or(
          ilike(applications.vehicleMake, `%${q}%`),
          ilike(applications.vehicleModel, `%${q}%`),
          ilike(applications.vehiclePlate, `%${q}%`),
        )
      : undefined,
  ].filter((clause) => clause !== undefined)
  const whereClause = filters.length > 0 ? and(...filters) : undefined

  const [items, stats, [filteredCount]] = await Promise.all([
    db
      .select()
      .from(applications)
      .where(whereClause)
      .orderBy(desc(applications.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    getApplicationStatusCounts(db),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(applications)
      .where(whereClause),
  ])

  sendJson(res, 200, {
    items,
    page,
    pageSize: PAGE_SIZE,
    hasMore: offset + items.length < (filteredCount?.count ?? 0),
    stats,
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
  await notify(db, application!.id, 'link_sent')

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
