import { and, eq, lt } from 'drizzle-orm'
import { getDb } from '../_lib/db'
import { applications } from '../_lib/schema'
import { transition } from '../_lib/stateMachine'
import { sendJson, type Handler } from '../_lib/http'

/**
 * Roda 1x/dia (ver `crons` em vercel.json). Uma proposta em `link_sent` cujo
 * token passou da validade nunca mais pode ser retomada pelo cliente — sem
 * isso ela ficaria pendurada em `link_sent` para sempre, poluindo a fila do
 * dealer e (mais importante para a Fase 6) nunca entrando na janela de
 * retenção, já que `retention-sweep.ts` só olha para estados terminais.
 * Protegido por `CRON_SECRET`, mesmo padrão do painel-do-ar.
 */
const handler: Handler = async (req, res) => {
  const expected = process.env.CRON_SECRET
  if (expected) {
    const authorization = req.headers.authorization
    if (authorization !== `Bearer ${expected}`) {
      sendJson(res, 401, { error: 'unauthorized' })
      return
    }
  }

  const db = await getDb()
  const stale = await db
    .select({ id: applications.id })
    .from(applications)
    .where(
      and(
        eq(applications.status, 'link_sent'),
        lt(applications.clientPortalTokenExpiresAt, new Date()),
      ),
    )

  const actor = { actorType: 'cron' as const }
  const expired: string[] = []
  const failed: string[] = []

  for (const application of stale) {
    try {
      await transition(db, application.id, 'expired', actor)
      expired.push(application.id)
    } catch {
      failed.push(application.id)
    }
  }

  sendJson(res, 200, { ok: true, count: expired.length, expired, failed })
}

export default handler
