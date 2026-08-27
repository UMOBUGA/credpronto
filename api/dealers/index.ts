import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../_lib/db'
import { dealerUsers, type DealerUser } from '../_lib/schema'
import { hashPassword, requireDealerRole } from '../_lib/auth'
import { logAction } from '../_lib/audit'
import { readJsonBody, sendJson, type Handler } from '../_lib/http'

const SAFE_COLUMNS = {
  id: dealerUsers.id,
  name: dealerUsers.name,
  email: dealerUsers.email,
  role: dealerUsers.role,
  createdAt: dealerUsers.createdAt,
  disabledAt: dealerUsers.disabledAt,
}

/**
 * `.returning()` do drizzle-orm não aceita um objeto de colunas como
 * `.select()` aceita — por isso essa função explícita em vez de mais um
 * `SAFE_COLUMNS` ali. Nunca desestrutura `passwordHash` pra descartar (isso
 * dispararia `no-unused-vars`); só copia os campos que devem sair.
 */
function toSafeUser(user: DealerUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    disabledAt: user.disabledAt,
  }
}

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['admin', 'manager', 'analyst']),
})

async function handleList(res: Parameters<Handler>[1], db: Awaited<ReturnType<typeof getDb>>) {
  const rows = await db.select(SAFE_COLUMNS).from(dealerUsers).orderBy(asc(dealerUsers.name))
  sendJson(res, 200, rows)
}

/**
 * Sem fluxo de convite por e-mail — o próprio admin define a senha inicial
 * no formulário (simplificação deliberada de portfólio, ver CLAUDE.md). Se
 * a Fase 16 já estiver disponível, notificar o novo usuário seria uma
 * extensão natural aqui, não um pré-requisito desta fase.
 */
async function handleCreate(
  req: Parameters<Handler>[0],
  res: Parameters<Handler>[1],
  db: Awaited<ReturnType<typeof getDb>>,
  actingUserId: string,
) {
  const parsed = createSchema.safeParse(await readJsonBody(req))
  if (!parsed.success) {
    sendJson(res, 400, { error: 'invalid_body', details: parsed.error.flatten() })
    return
  }

  const [existing] = await db
    .select({ id: dealerUsers.id })
    .from(dealerUsers)
    .where(eq(dealerUsers.email, parsed.data.email))
    .limit(1)
  if (existing) {
    sendJson(res, 409, { error: 'email_in_use' })
    return
  }

  const [created] = await db
    .insert(dealerUsers)
    .values({
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash: hashPassword(parsed.data.password),
      role: parsed.data.role,
    })
    .returning()

  await logAction(
    db,
    { actorType: 'dealer_user', actorId: actingUserId },
    {
      action: 'dealer_user.created',
      entityType: 'dealer_user',
      entityId: created!.id,
      metadata: { role: parsed.data.role },
    },
  )

  sendJson(res, 201, toSafeUser(created!))
}

/**
 * Gestão de usuários da loja (Fase 17) — schema/`requireDealerRole` já
 * existiam desde cedo (usados por `reveal.ts`), só faltava o CRUD. Restrito
 * a admin: `manager`/`analyst` operam a esteira sem gerenciar quem tem
 * acesso a ela.
 */
const handler: Handler = async (req, res) => {
  const db = await getDb()
  const user = await requireDealerRole(req, res, db, ['admin'])
  if (!user) return

  if (req.method === 'POST') {
    await handleCreate(req, res, db, user.id)
    return
  }
  await handleList(res, db)
}

export default handler
