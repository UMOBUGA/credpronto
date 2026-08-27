import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../_lib/db'
import { dealerUsers, type DealerUser } from '../_lib/schema'
import { requireDealerRole } from '../_lib/auth'
import { logAction } from '../_lib/audit'
import { lastPathSegment, readJsonBody, sendJson, type Handler } from '../_lib/http'

/**
 * `.returning()` do drizzle-orm não aceita objeto de colunas — cópia
 * explícita em vez de desestruturar `passwordHash` pra descartar (isso
 * dispararia `no-unused-vars`). Mesmo helper de `dealers/index.ts`.
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

const patchSchema = z
  .object({
    role: z.enum(['admin', 'manager', 'analyst']).optional(),
    disabled: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'empty_patch' })

/**
 * Trocar papel ou ativar/desativar um usuário da loja — restrito a admin,
 * mesmo padrão de `dealers/index.ts`. Um admin nunca consegue desativar a
 * própria conta (evita lockout: sem isso, o último admin logado poderia se
 * trancar fora do painel sem ninguém pra reverter).
 */
const handler: Handler = async (req, res) => {
  const db = await getDb()
  const actingUser = await requireDealerRole(req, res, db, ['admin'])
  if (!actingUser) return
  if (req.method !== 'PATCH') {
    sendJson(res, 405, { error: 'method_not_allowed' })
    return
  }

  const targetId = lastPathSegment(req)
  const parsed = patchSchema.safeParse(await readJsonBody(req))
  if (!parsed.success) {
    sendJson(res, 400, { error: 'invalid_body', details: parsed.error.flatten() })
    return
  }

  if (targetId === actingUser.id && parsed.data.disabled === true) {
    sendJson(res, 409, { error: 'cannot_disable_self' })
    return
  }

  const [target] = await db
    .select({ id: dealerUsers.id })
    .from(dealerUsers)
    .where(eq(dealerUsers.id, targetId))
    .limit(1)
  if (!target) {
    sendJson(res, 404, { error: 'not_found' })
    return
  }

  const [updated] = await db
    .update(dealerUsers)
    .set({
      ...(parsed.data.role !== undefined ? { role: parsed.data.role } : {}),
      ...(parsed.data.disabled !== undefined
        ? { disabledAt: parsed.data.disabled ? new Date() : null }
        : {}),
    })
    .where(eq(dealerUsers.id, targetId))
    .returning()

  await logAction(
    db,
    { actorType: 'dealer_user', actorId: actingUser.id },
    {
      action: 'dealer_user.updated',
      entityType: 'dealer_user',
      entityId: targetId,
      metadata: { fields: Object.keys(parsed.data) },
    },
  )

  sendJson(res, 200, toSafeUser(updated!))
}

export default handler
