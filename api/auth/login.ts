import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../_lib/db'
import { dealerUsers } from '../_lib/schema'
import { createSessionToken, sessionCookieHeader, verifyPassword } from '../_lib/auth'
import { readJsonBody, sendJson, type Handler } from '../_lib/http'
import { logAction } from '../_lib/audit'

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const handler: Handler = async (req, res) => {
  const parsed = bodySchema.safeParse(await readJsonBody(req))
  if (!parsed.success) {
    sendJson(res, 400, { error: 'invalid_body' })
    return
  }

  const db = await getDb()
  const [user] = await db
    .select()
    .from(dealerUsers)
    .where(eq(dealerUsers.email, parsed.data.email.toLowerCase()))
    .limit(1)

  if (!user || user.disabledAt || !verifyPassword(parsed.data.password, user.passwordHash)) {
    sendJson(res, 401, { error: 'invalid_credentials' })
    return
  }

  const token = createSessionToken(user.id)
  res.setHeader('Set-Cookie', sessionCookieHeader(token))
  await logAction(
    db,
    { actorType: 'dealer_user', actorId: user.id },
    { action: 'auth.login', entityType: 'dealer_user', entityId: user.id },
  )

  sendJson(res, 200, { id: user.id, name: user.name, email: user.email, role: user.role })
}

export default handler
