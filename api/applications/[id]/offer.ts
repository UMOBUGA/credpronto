import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../../_lib/db'
import { applications, loanOffers, type NewLoanOffer } from '../../_lib/schema'
import { requireDealerSession } from '../../_lib/auth'
import { transition } from '../../_lib/stateMachine'
import { pathSegment, readJsonBody, sendJson, type Handler } from '../../_lib/http'

/** Taxa fixa de portfólio — não vem de nenhuma tabela de produto real. */
export const FIXED_MONTHLY_RATE = 0.0199

const createSchema = z.object({
  amount: z.number().positive().optional(),
  termMonths: z.number().int().positive().optional(),
  interestRate: z.number().positive().optional(),
})

const patchSchema = z.object({ status: z.enum(['sent', 'accepted', 'declined']) })

const NEXT_APPLICATION_STATUS = {
  sent: 'offer_sent',
  accepted: 'offer_accepted',
  declined: 'offer_declined',
} as const

/** Exportada pra `scripts/seed.ts` reaproveitar em vez de duplicar a fórmula. */
export function calculateMonthlyPayment(
  principal: number,
  monthlyRate: number,
  termMonths: number,
): number {
  if (monthlyRate === 0) return principal / termMonths
  const factor = Math.pow(1 + monthlyRate, termMonths)
  return (principal * monthlyRate * factor) / (factor - 1)
}

async function handleCreate(
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
  if (application.status !== 'approved') {
    sendJson(res, 409, { error: 'not_approved', status: application.status })
    return
  }

  const parsed = createSchema.safeParse(await readJsonBody(req))
  if (!parsed.success) {
    sendJson(res, 400, { error: 'invalid_body' })
    return
  }

  const amount = parsed.data.amount ?? application.requestedAmount
  const termMonths = parsed.data.termMonths ?? application.requestedTermMonths
  const interestRate = parsed.data.interestRate ?? FIXED_MONTHLY_RATE

  const values: NewLoanOffer = {
    applicationId,
    amount,
    termMonths,
    interestRate,
    monthlyPayment: calculateMonthlyPayment(amount, interestRate, termMonths),
    status: 'draft',
  }
  const [offer] = await db.insert(loanOffers).values(values).returning()

  await transition(db, applicationId, 'offer_created', {
    actorType: 'dealer_user',
    actorId: dealerUserId,
  })

  sendJson(res, 201, offer)
}

async function handlePatch(
  req: Parameters<Handler>[0],
  res: Parameters<Handler>[1],
  db: Awaited<ReturnType<typeof getDb>>,
  applicationId: string,
  dealerUserId: string,
) {
  const parsed = patchSchema.safeParse(await readJsonBody(req))
  if (!parsed.success) {
    sendJson(res, 400, { error: 'invalid_body' })
    return
  }

  const [offer] = await db
    .select()
    .from(loanOffers)
    .where(eq(loanOffers.applicationId, applicationId))
    .orderBy(desc(loanOffers.createdAt))
    .limit(1)
  if (!offer) {
    sendJson(res, 404, { error: 'no_offer' })
    return
  }

  await db.update(loanOffers).set({ status: parsed.data.status }).where(eq(loanOffers.id, offer.id))
  await transition(db, applicationId, NEXT_APPLICATION_STATUS[parsed.data.status], {
    actorType: 'dealer_user',
    actorId: dealerUserId,
  })

  sendJson(res, 200, { ...offer, status: parsed.data.status })
}

const handler: Handler = async (req, res) => {
  const db = await getDb()
  const user = await requireDealerSession(req, res, db)
  if (!user) return
  const applicationId = pathSegment(req, 1)

  if (req.method === 'PATCH') {
    await handlePatch(req, res, db, applicationId, user.id)
    return
  }
  await handleCreate(req, res, db, applicationId, user.id)
}

export default handler
